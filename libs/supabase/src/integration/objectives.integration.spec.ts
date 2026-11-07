import { MoveTaskUsecase, Objective, Task } from '@org/objective';
import { SupabaseObjectiveRepository } from '../lib/objectives/repositories/objective.repository';
import { SupabaseTaskRepository } from '../lib/objectives/repositories/task.repository';
import { SupabaseGetObjectiveTreeQuery } from '../lib/objectives/bff/get-objective-tree.query';
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
  let tree: SupabaseGetObjectiveTreeQuery;

  beforeAll(async () => {
    const access = createIntegrationAccess();
    objectives = new SupabaseObjectiveRepository(access);
    tasks = new SupabaseTaskRepository(access);
    tree = new SupabaseGetObjectiveTreeQuery(access);
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

  it('recharge le pas et ses voisins complets, et déplacer un pas ne remet pas ses voisins à « non faits »', async () => {
    const { root, stage, done, todo } = await seedTree();

    const holder = await objectives.findObjectiveWithASpecificTaskId(todo.id, alice);
    expect(holder?.id).toBe(stage.id);
    expect(holder?.getTaskById(done.id)).toMatchObject({ done: true, description: 'Chez le spécialiste' });
    await expect(objectives.findObjectiveWithASpecificTaskId(todo.id, mallory)).resolves.toBeNull();

    // Remonter le pas vers l'objectif : tout l'arbre de l'objectif est réenregistré, voisins compris.
    const result = await new MoveTaskUsecase(objectives).execute({
      taskId: todo.id,
      objectiveId: root.id,
      ownerId: alice,
    });

    expect(result.success).toBe(true);
    await expect(tasks.findById(done.id, alice)).resolves.toMatchObject({
      done: true,
      description: 'Chez le spécialiste',
    });
    await expect(tasks.findById(todo.id, alice)).resolves.toMatchObject({
      title: 'Courir 5 km',
      objectiveId: root.id,
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

  it('supprime un objectif avec son sous-arbre, au nom de sa propriétaire seulement', async () => {
    const { root, stage, done, todo } = await seedTree();
    const subStage = new Objective(testId('s'), 'Sous-étape');
    const reloadedStage = (await objectives.findById(stage.id, alice)) as Objective;
    reloadedStage.addSubObjective(subStage);
    subStage.addTask(new Task(testId('t'), 'Au fond', 1, 1));
    expect(await objectives.save(reloadedStage, alice)).toBe(true);

    await expect(objectives.delete(root.id, mallory)).resolves.toBe(false);
    await expect(objectives.delete(stage.id, mallory)).resolves.toBe(false);
    await expect(objectives.findById(root.id, alice)).resolves.toMatchObject({ id: root.id });

    await expect(objectives.delete(root.id, alice)).resolves.toBe(true);

    await expect(objectives.findById(root.id, alice)).resolves.toBeNull();
    await expect(objectives.findById(stage.id, alice)).resolves.toBeNull();
    await expect(objectives.findById(subStage.id, alice)).resolves.toBeNull();
    await expect(tasks.findById(done.id, alice)).resolves.toBeNull();
    await expect(tasks.findById(todo.id, alice)).resolves.toBeNull();
    await expect(tasks.findById(subStage.tasks[0].id, alice)).resolves.toBeNull();
    await expect(objectives.delete(root.id, alice)).resolves.toBe(false);
  });

  it('supprime une étape sans toucher à son objectif', async () => {
    const { root, stage, done } = await seedTree();
    const direct = new Task(testId('t'), 'Sur l’objectif', 1, 1);
    const reloadedRoot = (await objectives.findById(root.id, alice)) as Objective;
    reloadedRoot.addTask(direct);
    expect(await objectives.save(reloadedRoot, alice)).toBe(true);

    await expect(objectives.delete(stage.id, alice)).resolves.toBe(true);

    const remaining = await objectives.findById(root.id, alice);
    expect(remaining?.subObjectives).toEqual([]);
    expect(remaining?.tasks.map((task) => task.id)).toEqual([direct.id]);
    await expect(tasks.findById(done.id, alice)).resolves.toBeNull();
  });

  it('supprime un pas au nom de sa propriétaire seulement, sans toucher à ses voisins', async () => {
    const { stage, done, todo } = await seedTree();

    await expect(tasks.delete(todo.id, mallory)).resolves.toBe(false);
    await expect(tasks.findById(todo.id, alice)).resolves.not.toBeNull();

    await expect(tasks.delete(todo.id, alice)).resolves.toBe(true);

    await expect(tasks.findById(todo.id, alice)).resolves.toBeNull();
    await expect(tasks.findById(done.id, alice)).resolves.not.toBeNull();
    await expect(objectives.findById(stage.id, alice)).resolves.not.toBeNull();
    await expect(tasks.delete(todo.id, alice)).resolves.toBe(false);
  });

  it('BFF : rend les pas dans un ordre stable, que les cocher ne change pas', async () => {
    const { stage, done, todo } = await seedTree();
    const stageTasks = async () => {
      const { objectives: roots } = await tree.execute({ ownerId: alice });
      const node = roots.flatMap((objective) => objective.subObjectives).find((sub) => sub.id === stage.id);
      return node?.tasks.map((task) => task.id);
    };

    expect(await stageTasks()).toEqual([done.id, todo.id]);

    // Cocher un pas ne change pas l'ordre de lecture (dans Apex, la ligne passait en fin de liste).
    const reloaded = (await tasks.findById(done.id, alice)) as Task;
    await tasks.update(reloaded.setDone(false) as Task, alice);
    expect(await stageTasks()).toEqual([done.id, todo.id]);

    const allTasks = await tasks.getAllUserTasks(alice);
    expect(allTasks.find((task) => task.id === todo.id)?.objectiveId).toBe(stage.id);
  });

  it("BFF : rend l'arbre de la personne, et seulement le sien, avec `done` tel qu'il est en base", async () => {
    const { root, stage, done, todo } = await seedTree();
    const malloryObjective = new Objective(testId('o'), 'Objectif de Mallory');
    malloryObjective.addTask(new Task(testId('t'), 'Pas de Mallory', 3, 3));
    await objectives.save(malloryObjective, mallory);

    const aliceTree = await tree.execute({ ownerId: alice });
    const node = aliceTree.objectives.find((objective) => objective.id === root.id);

    expect(aliceTree.objectives.map((objective) => objective.id)).not.toContain(malloryObjective.id);
    expect(aliceTree.objectives.map((objective) => objective.id)).not.toContain(stage.id);
    expect(node).toMatchObject({
      title: 'Courir un marathon',
      why: 'Pour moi',
      description: '',
      done: false,
    });
    expect(node?.subObjectives.map((objective) => objective.id)).toEqual([stage.id]);
    expect(node?.subObjectives[0].tasks).toEqual([
      { id: done.id, title: 'Acheter des chaussures', importance: 2, urgency: 4, done: true },
      { id: todo.id, title: 'Courir 5 km', importance: 4, urgency: 2, done: false },
    ]);

    const malloryTree = await tree.execute({ ownerId: mallory });
    expect(malloryTree.objectives.map((objective) => objective.id)).toContain(malloryObjective.id);
    expect(malloryTree.objectives.map((objective) => objective.id)).not.toContain(root.id);
  });
});
