export class PromiseChain {
  private current: Promise<any> = Promise.resolve();

  public push<T, TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    return (this.current = this.current.then(onfulfilled).catch(onrejected));
  }
}
