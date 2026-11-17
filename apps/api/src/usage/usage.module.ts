import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HeldReservations, UsageGate, UsageLedger, UsagePolicySource } from '@org/usage';
import { AssistantModule } from '../assistant/assistant.module';
import { AssistantTurnSettlement } from './assistant-turn.settlement';
import { UsageController } from './usage.controller';
import { UsageInterceptor } from './usage.interceptor';

/**
 * Les politiques d'usage (docs/adr/0010-politiques-d-usage.md) : l'intercepteur global qui réserve et rend les
 * unités des routes marquées `@UsageAction`, `GET /v2/usage`, et la fin des tours d'Akari. Retirer ce module
 * de l'`AppModule` débranche tout : les routes restent marquées, mais rien ne les compte plus.
 */
@Module({
  imports: [AssistantModule],
  controllers: [UsageController],
  providers: [
    {
      provide: UsageGate,
      useFactory: (policies: UsagePolicySource, ledger: UsageLedger) => new UsageGate(policies, ledger),
      inject: [UsagePolicySource, UsageLedger],
    },
    { provide: HeldReservations, useFactory: () => new HeldReservations() },
    { provide: APP_INTERCEPTOR, useClass: UsageInterceptor },
    AssistantTurnSettlement,
  ],
})
export class UsageModule {}
