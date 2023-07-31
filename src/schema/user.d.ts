import { UniqItem } from '.';

export interface User extends UniqItem {
  name: {
    first: string;
    last: string;
  };
  age: number;
  eyeColor?: string | null;
  isMarried: boolean;
}
