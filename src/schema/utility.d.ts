type DotPrefix<T extends string> = T extends '' ? '' : `.${T}`;

/**
 *
 * @summary Extracts paths of all terminal properties ("leaves") of an object.
 */
export type PropertyPath<T> = (
  T extends object
    ? {
        [K in Exclude<keyof T, symbol>]: `${K}${DotPrefix<PropertyPath<T[K]>>}`;
      }[Exclude<keyof T, symbol>]
    : ''
) extends infer D
  ? Extract<D, string>
  : never;

export type IsNullable<T> = Extract<T, null> extends never ? false : true;
