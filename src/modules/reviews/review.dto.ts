import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  comment?: string;
}

export class ReviewQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'published', 'pending', 'hidden'] })
  @IsIn(['all', 'published', 'pending', 'hidden'])
  @IsOptional()
  status?: string = 'all';
}

export class UpdateReviewDto {
  @ApiProperty({ enum: ['published', 'pending', 'hidden'] })
  @IsIn(['published', 'pending', 'hidden'])
  status: 'published' | 'pending' | 'hidden';
}
