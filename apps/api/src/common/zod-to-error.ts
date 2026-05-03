import { ZodError } from 'zod';
import { AppException, ErrorCode } from './errors';

/**
 * Конвертация zod-ошибки в AppException с code=VALIDATION_FAILED, либо
 * специализированный code если конкретное поле помечено в map'е.
 */
export function zodToAppException(
  err: ZodError,
  fieldCodeMap: Record<string, ErrorCode> = {},
): AppException {
  const issue = err.issues[0];
  const path = issue?.path.join('.') ?? '';
  const code = fieldCodeMap[path] ?? ErrorCode.VALIDATION_FAILED;
  const message = issue ? `${path ? `${path}: ` : ''}${issue.message}` : 'Validation failed';
  return new AppException(code, message, 400, {
    issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}
