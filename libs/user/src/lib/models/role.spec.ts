import { DEFAULT_ROLE, hasAnyRole, parseRoles, withDefaultRole } from './role';
import { User } from './user';

describe('Rôles', () => {
  describe('parseRoles', () => {
    it('garde les rôles connus, une seule fois chacun', () => {
      expect(parseRoles(['premium', 'admin', 'premium'])).toEqual(['premium', 'admin']);
      expect(parseRoles(['standard'])).toEqual(['standard']);
    });

    it("ignore ce qui n'est pas un rôle connu, « basic » compris", () => {
      expect(parseRoles(['basic', 'superadmin', 42, null, 'admin'])).toEqual(['admin']);
    });

    it("rend une liste vide quand il n'y a pas de liste : le rôle par défaut vient de User", () => {
      for (const value of [undefined, null, 'admin', { roles: ['admin'] }]) {
        expect(parseRoles(value)).toEqual([]);
      }
    });
  });

  describe('withDefaultRole', () => {
    it('donne le rôle standard à qui n’en a aucun', () => {
      expect(DEFAULT_ROLE).toBe('standard');
      expect(withDefaultRole([])).toEqual(['standard']);
    });

    it("n'ajoute rien à qui a déjà un rôle : un admin ou un premium n'est pas standard", () => {
      expect(withDefaultRole(['admin'])).toEqual(['admin']);
      expect(withDefaultRole(['premium', 'premium'])).toEqual(['premium']);
    });
  });

  describe('hasAnyRole', () => {
    it("laisse passer dès qu'un des rôles demandés est là", () => {
      expect(hasAnyRole(['premium'], ['premium', 'admin'])).toBe(true);
      expect(hasAnyRole(['admin'], ['premium', 'admin'])).toBe(true);
    });

    it("refuse un compte standard et un rôle qui n'est pas demandé", () => {
      expect(hasAnyRole(['standard'], ['premium'])).toBe(false);
      expect(hasAnyRole(['premium'], ['admin'])).toBe(false);
    });
  });

  describe('User', () => {
    it("est standard tant qu'on ne lui donne pas de rôle", () => {
      expect(new User('u1', 'alice@apex.test').roles).toEqual(['standard']);
    });

    it('garde chaque rôle une seule fois', () => {
      const user = new User('u1', 'alice@apex.test');
      user.setRoles(['premium', 'premium', 'admin']);

      expect(user.roles).toEqual(['premium', 'admin']);
    });

    it('redevient standard quand on lui retire tous ses rôles', () => {
      const user = new User('u1', 'alice@apex.test');
      user.setRoles(['premium']);
      user.setRoles([]);

      expect(user.roles).toEqual(['standard']);
    });
  });
});
