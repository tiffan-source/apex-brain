import { EditMyTaskUsecase, Objective, Task } from '@org/objective';
import { SupabaseObjectiveRepository } from '../lib/objectives/repositories/objective.repository';
import { SupabaseTaskRepository } from '../lib/objectives/repositories/task.repository';
import { SupabaseGetAllObjectiveAndTaskQuery } from '../lib/objectives/queries/get-all-objective-and-tasks.query';
import {
  createIntegrationAccess,
  createTestUser,
  integrationEnabled,
  testId,
} from './supabase-test-environment';

describe.skipIf(!integrationEnabled)('Supabase — objectifs et pas (intégration)', () => {
  let alice: string;
  let mallory: string;
  let objectives: SupabaseObjectiveRepository;
  let tasks: SupabaseTaskRepository;
  let query: SupabaseGetAllObjectiveAndTaskQuery;

  beforeAll(async () => {
    const access = createIntegrationAccess();
    objectives = new SupabaseObjectiveRepository(access);
    tasks = new SupabaseTaskRepository(access);
    query = new SupabaseGetAllObjectiveAndTaskQuery(access);
    alice = (await createTestUser('alice')).id;
    mallory = (await createTestUser('mallory')).id;
  });

  /**
   * Un objectif avec une étape et deux pas, dont un fait, ajoutés l'un après l'autre comme le font
   * les cas d'usage (un `save` par geste). Les lignes écrites par un même `save` partagent leur
   * `created_at` : leur ordre ne dépend plus que de leur id.
   */
  async function seedTree() {
    const root = new Objective(testId('o'), 'Courir un marathon');
    root.setWhy('Pour moi');
    const stage = new Objective(testId('s'), 'Préparer le corps');
    root.addSubObjective(stage);
    const done = new Task(testId('t'), 'Acheter des chaussures', 2, 4).setDone(true) as Task;
    done.setDescription('Chez le spécialiste');
    stage.addTask(done);
    expect(await objectives.save(root, alice)).toBe(true);

    const todo = new Task(testId('t'), 'Courir 5 km', 4, 2);
    const reloadedStage = (await objectives.findById(stage.id, alice)) as Objective;
    reloadedStage.addTask(todo);
    expect(await objectives.save(reloadedStage, alice)).toBe(true);

    return { root, stage, done, todo };
  }

  it("enregistre et recharge l'arbre complet, dans l'ordre de création", async () => {
    const { root, stage, done, todo } = await seedTree();

    const loaded = await objectives.findById(root.id, alice);

    expect(loaded?.why).toBe('Pour moi');
    expect(loaded?.subObjectives.map((objective) => objective.id)).toEqual([stage.id]);
    expect(loaded?.subObjectives[0].tasks.map((task) => [task.id, task.done, task.objectiveId])).toEqual([
      [done.id, true, stage.id],
      [todo.id, false, stage.id],
    ]);
  });

  it("ne rend rien à une autre personne et refuse qu'elle écrase l'objectif", async () => {
    const { root } = await seedTree();

    await expect(objectives.findById(root.id, mallory)).resolves.toBeNull();

    const stolen = new Objective(root.id, 'Volé');
    await expect(objectives.save(stolen, mallory)).resolves.toBe(false);
    await expect(objectives.findById(root.id, alice)).resolves.toMatchObject({ title: 'Courir un marathon' });
  });

  it("recharge le pas et ses voisins complets, et l'édition d'un pas ne remet pas ses voisins à « non faits »", async () => {
    const { stage, done, todo } = await seedTree();

    const holder = await objectives.findObjectiveWithASpecificTaskId(todo.id, alice);
    expect(holder?.id).toBe(stage.id);
    expect(holder?.getTaskById(done.id)).toMatchObject({ done: true, description: 'Chez le spécialiste' });
    await expect(objectives.findObjectiveWithASpecificTaskId(todo.id, mallory)).resolves.toBeNull();

    const result = await new EditMyTaskUsecase(objectives).execute({
      task: { id: todo.id, title: 'Courir 10 km', objectiveId: stage.id, importance: 5, urgency: 3 },
      ownerId: alice,
    });

    expect(result.success).toBe(true);
    await expect(tasks.findById(done.id, alice)).resolves.toMatchObject({
      done: true,
      description: 'Chez le spécialiste',
    });
    await expect(tasks.findById(todo.id, alice)).resolves.toMatchObject({
      title: 'Courir 10 km',
      importance: 5,
    });
  });

  it('filtre les pas par propriétaire', async () => {
    const { done } = await seedTree();

    await expect(tasks.findById(done.id, mallory)).resolves.toBeNull();
    await expect(tasks.findById('inconnu', alice)).resolves.toBeNull();

    const forged = new Task(done.id, 'Volé', 1, 1);
    await expect(tasks.update(forged, mallory)).resolves.toBe(false);
    await expect(tasks.findById(done.id, alice)).resolves.toMatchObject({ title: 'Acheter des chaussures' });

    const mine = (await tasks.findById(done.id, alice)) as Task;
    mine.setDone(false);
    await expect(tasks.update(mine, alice)).resolves.toBe(true);
    await expect(tasks.findById(done.id, alice)).resolves.toMatchObject({ done: false });
  });

  it('charge tout ce qui appartient à la personne, et seulement cela, dans un ordre stable', async () => {
    const { root, stage, done, todo } = await seedTree();
    const malloryObjective = new Objective(testId('o'), 'Objectif de Mallory');
    await objectives.save(malloryObjective, mallory);

    const first = await query.execute({ ownerId: alice });
    const objectiveIds = first.objectives.map((objective) => objective.id);

    expect(objectiveIds).toEqual(expect.arrayContaining([root.id, stage.id]));
    expect(objectiveIds).not.toContain(malloryObjective.id);
    expect(first.objectives.find((objective) => objective.id === stage.id)?.parentObjective).toBe(root.id);
    expect(first.tasks.filter((task) => [done.id, todo.id].includes(task.id)).map((task) => task.id)).toEqual(
      [done.id, todo.id],
    );

    // Cocher un pas ne change plus l'ordre de lecture (dans Apex, la ligne passait en fin de liste).
    const reloaded = (await tasks.findById(done.id, alice)) as Task;
    await tasks.update(reloaded.setDone(false) as Task, alice);
    const second = await query.execute({ ownerId: alice });
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id));

    const allTasks = await tasks.getAllUserTasks(alice);
    expect(allTasks.find((task) => task.id === todo.id)?.objectiveId).toBe(stage.id);
  });
});
