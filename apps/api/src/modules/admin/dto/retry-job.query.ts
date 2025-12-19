import { IsString } from "class-validator";

export class RetryJobQuery {
  @IsString()
  queue!: string;
}

