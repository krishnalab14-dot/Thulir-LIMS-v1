import { Controller, Get, Param, Put, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';

/**
 * Critical Value Alerting (Stage 9) — in-app acknowledgment system.
 * The visual red-cell flag (Stage 3) remains; this adds the acknowledgment
 * layer on top. External SMS/WhatsApp notification is deferred alongside
 * Report Delivery (same provider-account dependency).
 */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * GET /api/alerts?filter=unacknowledged — inbox list.
   * No role gate: every authenticated staff member should be able to see
   * and acknowledge alerts (the LIMS workload is shared across roles).
   */
  @Get()
  list(@Query('filter') filter?: 'acknowledged' | 'unacknowledged') {
    return this.alertsService.listAlerts(filter);
  }

  /**
   * GET /api/alerts/count — unacknowledged count for the NavBar badge.
   * Includes both critical-value alerts AND inventory alerts.
   */
  @Get('count')
  async count() {
    const n = await this.alertsService.unacknowledgedCount();
    return { count: n };
  }

  /**
   * PUT /api/alerts/:id/acknowledge — conditional update, concurrency-safe.
   * Returns 409 if already acknowledged, 404 if not found.
   */
  @Put(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.alertsService.acknowledge(id);
  }
}
