import {
  EMPTY,
  Observable,
  ObservableInput,
  OperatorFunction,
  ReplaySubject,
  Subject,
  buffer,
  defer,
  finalize,
  firstValueFrom,
  from,
  groupBy,
  identity,
  mergeAll,
  mergeMap,
  throttle,
} from 'rxjs';

/**
 *
 * @summary Sometimes we want the throttling behavior of exhaustMap without losing the last emission. This is helpful in situations where we want to only issue one request at a time, but if we are told to issue another while issuing the first, we respect that. Think of it as a nicer switchMap.
 *
 * @see https://github.com/ReactiveX/rxjs/issues/5004
 *
 * @see https://stackoverflow.com/questions/76962733/looking-for-an-rxjs-operator-like-audit-or-throttle-but-not-quite
 *
 * @todo TODO mergeMap or exhaustMap? https://github.com/ReactiveX/rxjs/issues/5004#issuecomment-1690610571
 */
export function bufferSwitchMap<T, R>(
  project: (value: T, index: number) => ObservableInput<R>
): OperatorFunction<T, R> {
  return (source): Observable<R> => {
    const release = new Subject<void>();

    return source.pipe(
      throttle(() => release, {
        leading: true,
        trailing: true,
      }),
      mergeMap((value, index) =>
        from(project(value, index)).pipe(finalize(() => release.next()))
      )
    );
  };
}

/**
 *
 * @summary It's like {@link bufferSwitchMap}, but source values are grouped before being merged into one single stream: at first each group piping in is being assigned one slot in that main queue. Once that slot's ready, the last value from the resp. group will be sent to projection; when projection is finished the slot will be freed again. So while waiting for actual projection, items will be buffered; items piping in while their group is already being projected will be getting assigned a new slot later.
 *
 * @example https://stackblitz.com/edit/rxjs-4vqyuh?file=index.ts
 */
export function groupBufferSwitchMap<T, R>(
  project: (value: T) => ObservableInput<R>,
  key: (value: T) => unknown = identity
): OperatorFunction<T, R> {
  const queue = new Subject<Observable<void>>();

  queue.pipe(mergeAll(1)).subscribe();

  return (source): Observable<R> =>
    source.pipe(
      groupBy(key),
      mergeMap((group) => {
        const release = new Subject<void>();
        const flush = new ReplaySubject<void>();

        group
          .pipe(
            throttle(() => release, {
              leading: true,
              trailing: true,
            }),
            mergeMap(() => {
              const slot = new ReplaySubject<void>();

              queue.next(defer(() => (slot.next(), firstValueFrom(release))));

              return firstValueFrom(slot);
            })
          )
          .subscribe({
            next: () => flush.next(),
          });

        return group.pipe(
          buffer(flush),
          mergeMap((values) =>
            (values.length ? from(project(values.slice(-1)[0])) : EMPTY).pipe(
              finalize(() => release.next())
            )
          )
        );
      })
    );
}
