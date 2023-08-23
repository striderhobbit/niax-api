import {
  Observable,
  ObservableInput,
  OperatorFunction,
  Subject,
  finalize,
  from,
  mergeMap,
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
