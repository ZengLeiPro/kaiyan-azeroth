import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { WebsiteLeadIngestDto } from './dto/website-lead-ingest.dto';
import { WebsiteLeadIngestResult, WebsiteLeadsService } from './website-leads.service';

@Public()
@SkipThrottle()
@SkipAudit()
@Controller({ path: 'internal/website-leads', version: VERSION_NEUTRAL })
export class WebsiteLeadsController {
  constructor(private readonly websiteLeadsService: WebsiteLeadsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  ingest(
    @Body() body: WebsiteLeadIngestDto,
    @Headers('x-website-lead-timestamp') timestamp?: string,
    @Headers('x-website-lead-signature') signature?: string
  ): Promise<WebsiteLeadIngestResult> {
    this.websiteLeadsService.verifySignature(body, timestamp, signature);
    return this.websiteLeadsService.ingest(body);
  }
}
