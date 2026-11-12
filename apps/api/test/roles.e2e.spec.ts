import { Controller, Get, Module } from '@nestjs/common';
import { Roles } from '../src/auth/auth.decorators';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

/**
 * Des routes qui n'existent que dans ce test : aucune route d'Apex n'est encore réservée à un
 * rôle. Elles traversent toute l'app (gardes globales, filtre d'erreurs).
 */
@Roles(['admin'])
@Controller('roles-probe')
class RolesProbeController {
  /** Hérite du contrôleur : admin seulement. */
  @Get('admin')
  admin() {
    return { opened: 'admin' };
  }

  /** Remplace le contrôleur : premium ou admin. */
  @Roles(['premium', 'admin'])
  @Get('premium')
  premium() {
    return { opened: 'premium' };
  }
}

@Module({ controllers: [RolesProbeController] })
class RolesProbeModule {}

describe('Rôles (e2e)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp({}, { modules: [RolesProbeModule] });
  });

  afterEach(() => t.close());

  const get = (path: string, authorization?: string) => {
    const call = t.http().get(path);
    return authorization ? call.set('Authorization', authorization) : call;
  };

  it("refuse en 403 FORBIDDEN une personne connectée dont aucun rôle n'ouvre la route", async () => {
    const basic = t.signIn('basique@apex.test');
    const premium = t.signIn('premium@apex.test', ['premium']);

    const response = await get('/v2/roles-probe/premium', basic.authorization);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
    expect((await get('/v2/roles-probe/admin', premium.authorization)).status).toBe(403);
  });

  it("laisse passer dès qu'un des rôles demandés est là, la méthode remplaçant le contrôleur", async () => {
    const premium = t.signIn('premium@apex.test', ['premium']);
    const admin = t.signIn('admin@apex.test', ['admin']);

    const opened = await get('/v2/roles-probe/premium', premium.authorization);

    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({ opened: 'premium' });
    expect((await get('/v2/roles-probe/premium', admin.authorization)).status).toBe(200);
    expect((await get('/v2/roles-probe/admin', admin.authorization)).status).toBe(200);
  });

  it('répond 401, et non 403, sans jeton : on reconnaît la personne avant de regarder ses rôles', async () => {
    const response = await get('/v2/roles-probe/premium');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ne change rien aux routes sans @Roles : un compte de base y accède', async () => {
    const basic = t.signIn('basique@apex.test');

    expect((await get('/v2/bff/objective-tree', basic.authorization)).status).toBe(200);
  });
});
