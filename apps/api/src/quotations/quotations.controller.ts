import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { QuotationsService, UploadedFile } from './quotations.service';

const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/jpg',
];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

@ApiTags('Quotations')
@ApiBearerAuth()
@Controller()
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Post('requests/:requestId/quotations')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}. Allowed: PDF, DOCX, JPG, PNG.`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @Param('requestId') requestId: string,
    @UploadedFiles() files: UploadedFile[],
    @Query('supplierId') supplierId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }
    return this.service.uploadMany(requestId, files, user.id, supplierId);
  }

  @Get('requests/:requestId/quotations')
  findByRequest(@Param('requestId') requestId: string) {
    return this.service.findByRequest(requestId);
  }

  @Get('quotations/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get('quotations/:id/download')
  download(@Param('id') id: string) {
    return this.service.getDownloadUrl(id);
  }

  // Re-run AI extraction for a single quotation.
  @Post('quotations/:id/reprocess')
  reprocess(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.process(id, user.id);
  }

  @Delete('quotations/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
