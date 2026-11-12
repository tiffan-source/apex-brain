import { hasAnyRole, parseRoles } from './role';
import { User } from './user';

describe('Rôles', () => {
  describe('parseRoles', () => {
    it('garde les rôles connus, une seule fois chacun', () => {
      expect(parseRoles(['premium', 'admin', 'premium'])).toEqual(['premium', 'admin']);
    });

    it("ignore ce qui n'est pas un rôle connu, « basic » compris", () => {
      expect(parseRoles(['basic', 'superadmin', 42, null, 'admin'])).toEqual(['admin']);
    });

    it("rend un compte de base quand il n'y a pas de liste", () => {
      for (const value of [undefined, null, 'admin', { roles: ['admin'] }]) {
        expect(parseRoles(value)).toEqual([]);
      }
    });
  });

  describe('hasAnyRole', () => {
    it("laisse passer dès qu'un des rôles demandés est là", () => {
      expect(hasAnyRole(['premium'], ['premium', 'admin'])).toBe(true);
      expect(hasAnyRole(['admin'], ['premium', 'admin'])).toBe(true);
    });

    it("refuse un compte de base et un rôle qui n'est pas demandé", () => {
      expect(hasAnyRole([], ['premium'])).toBe(false);
      expect(hasAnyRole(['premium'], ['admin'])).toBe(false);
    });
  });

  describe('User', () => {
    it("est un compte de base tant qu'on ne lui donne pas de rôle", () => {
      expect(new User('u1', 'alice@apex.test').roles).toEqual([]);
    });

    it('garde chaque rôle une seule fois', () => {
      const user = new User('u1', 'alice@apex.test');
      user.setRoles(['premium', 'premium', 'admin']);

      expect(user.roles).toEqual(['premium', 'admin']);
    });
  });
});
