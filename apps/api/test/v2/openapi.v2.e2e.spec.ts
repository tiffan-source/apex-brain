import type { TestApp } from '../support/test-app';
import { createTestApp } from '../support/test-app';

describe('v2 — document OpenAPI (e2e)', () => {
  let t: TestApp;

  afterEach(() => t?.close());

  it('publie les commandes v2 sous leur nom, le BFF sous son tag, et ne sert plus la v1', async () => {
    t = await createTestApp();
    const document = (await t.http().get('/docs-json')).body;

    const operation = (path: string, method: string) => document.paths[path]?.[method];
    const expected: Array<[string, string, string]> = [
      ['/v2/objectives', 'post', 'createObjective'],
      ['/v2/objectives/{objectiveId}/sub-objectives', 'post', 'addSubObjective'],
      ['/v2/objectives/{objectiveId}/tasks', 'post', 'addTaskToObjective'],
      ['/v2/objectives/{objectiveId}/rename', 'patch', 'renameObjective'],
      ['/v2/objectives/{objectiveId}/clarify', 'patch', 'clarifyObjective'],
      ['/v2/objectives/{objectiveId}/set-deadline', 'patch', 'setObjectiveDeadline'],
      ['/v2/objectives/{objectiveId}/remove-deadline', 'patch', 'removeObjectiveDeadline'],
      ['/v2/objectives/{objectiveId}', 'delete', 'deleteObjective'],
      ['/v2/tasks/{taskId}/rename', 'patch', 'renameTask'],
      ['/v2/tasks/{taskId}/reprioritize', 'patch', 'reprioritizeTask'],
      ['/v2/tasks/{taskId}/move', 'patch', 'moveTask'],
      ['/v2/tasks/{taskId}/complete', 'patch', 'completeTask'],
      ['/v2/tasks/{taskId}/reopen', 'patch', 'reopenTask'],
      ['/v2/tasks/{taskId}', 'delete', 'deleteTask'],
      ['/v2/tasks/today-focus', 'get', 'whatIsTodayFocus'],
      ['/v2/bff/objective-tree', 'get', 'getObjectiveTree'],
    ];
    for (const [path, method, operationId] of expected) {
      expect(operation(path, method)?.operationId, `${method.toUpperCase()} ${path}`).toBe(operationId);
      expect(operation(path, method)?.deprecated).toBeFalsy();
    }

    expect(operation('/v2/bff/objective-tree', 'get').tags).toEqual(['bff']);
    expect(document.components.schemas).toHaveProperty('ObjectiveTreeNode');

    // L'ancien vocabulaire n'existe plus en v2.
    expect(document.paths).not.toHaveProperty('/v2/tasks/{taskId}/done');
    expect(operation('/v2/objectives', 'get')).toBeUndefined();
    expect(operation('/v2/objectives/{objectiveId}', 'patch')).toBeUndefined();
    expect(operation('/v2/tasks/{taskId}', 'patch')).toBeUndefined();

    // La v1 est retirée : plus aucune route sous /v1, authentification et assistant compris.
    expect(Object.keys(document.paths).filter((path) => path.startsWith('/v1/'))).toEqual([]);
    for (const path of [
      '/auth/login',
      '/auth/me',
      '/objectives/{objectiveId}/conversation',
      '/objectives/{objectiveId}/assistant/messages',
    ]) {
      expect(document.paths).toHaveProperty(`/v2${path}`);
    }

    const operationIds = Object.values(document.paths).flatMap((methods) =>
      Object.values(methods as Record<string, { operationId: string }>).map((op) => op.operationId),
    );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
