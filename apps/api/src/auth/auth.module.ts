import { Module } from '@nestjs/common';
import {
  AuthProvider,
  CreateNewUserUseCase,
  GetCurrentUserUseCase,
  LogUserInUseCase,
  LogUserOutUseCase,
  RefreshSessionUseCase,
} from '@org/auth';
import { AuthController } from './auth.controller';

const fromAuthProvider = <T>(provide: new (provider: AuthProvider) => T) => ({
  provide,
  useFactory: (provider: AuthProvider) => new provide(provider),
  inject: [AuthProvider],
});

/** Les cas d'usage d'authentification, assemblés sur le port `AuthProvider`. */
@Module({
  controllers: [AuthController],
  providers: [
    fromAuthProvider(CreateNewUserUseCase),
    fromAuthProvider(LogUserInUseCase),
    fromAuthProvider(RefreshSessionUseCase),
    fromAuthProvider(LogUserOutUseCase),
    fromAuthProvider(GetCurrentUserUseCase),
  ],
  exports: [GetCurrentUserUseCase],
})
export class AuthModule {}
