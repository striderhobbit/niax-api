type DotPrefix<T extends string> = T extends '' ? '' : `.${T}`;

export type Path<T> = (
  [T] extends [never]
    ? ''
    : T extends object
    ? {
        [K in Exclude<keyof T, symbol>]: `${K}${undefined extends T[K]
          ? '?'
          : ''}${DotPrefix<Path<T[K]>>}`;
      }[Exclude<keyof T, symbol>]
    : ''
) extends infer D
  ? Extract<D, string>
  : never;

export interface UniqItem {
  id: string;
}
