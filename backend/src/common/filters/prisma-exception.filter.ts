import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { Prisma } from "@prisma/client";

const MAPPED: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: "이미 같은 항목이 있어요" },
  P2003: { status: HttpStatus.CONFLICT, message: "연결된 항목이 있어 처리할 수 없어요" },
  P2025: { status: HttpStatus.NOT_FOUND, message: "대상을 찾을 수 없어요" },
  P2028: { status: HttpStatus.CONFLICT, message: "동시에 처리 중인 요청이 있어요. 잠시 후 다시 시도해 주세요" },
  P2034: { status: HttpStatus.CONFLICT, message: "동시에 변경된 정보가 있어요. 잠시 후 다시 시도해 주세요" }
};

// 서비스가 따로 잡지 않은 Prisma 알려진 오류를 500 대신 의미 있는 상태 코드로 바꾼다.
// HttpException은 이 필터의 대상이 아니므로(Catch 대상이 Prisma 오류뿐) 그대로 통과한다.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const mapped = MAPPED[exception.code];
    // 매핑 대상이 아니거나 HTTP 컨텍스트가 아니면 Nest 기본 처리(로그 + 500)에 맡긴다.
    if (!mapped || host.getType() !== "http" || !response || typeof response.status !== "function") {
      super.catch(exception, host);
      return;
    }
    response.status(mapped.status).json({ statusCode: mapped.status, message: mapped.message, error: mapped.status === 404 ? "Not Found" : "Conflict" });
  }
}
