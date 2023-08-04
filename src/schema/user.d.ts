import { Resource } from './resource';

export interface User extends Resource.Item {
  name: {
    first: string;
    last: string;
  };
  age: number;
  eyeColor?: string | null;
  isMarried: boolean;
}
