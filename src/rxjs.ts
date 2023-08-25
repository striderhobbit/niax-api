import { identity } from 'lodash';
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
  mergeAll,
  mergeMap,
  tap,
  throttle,
} from 'rxjs';

/**
 * @see https://github.com/ReactiveX/rxjs/issues/5004
 * @see https://stackoverflow.com/questions/76962733/looking-for-an-rxjs-operator-like-audit-or-throttle-but-not-quite
 * @todo TODO mergeMap or exhaustMap? https://github.com/ReactiveX/rxjs/issues/5004#issuecomment-1690610571
 */
export function bufferExhaustMap<T, R>(
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

export function multiBufferExhaustMap<T, R>(
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
            }),
            tap(() => flush.next())
          )
          .subscribe();

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
