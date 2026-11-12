import { Test } from '@nestjs/testing';
import { InteractiveAIProvider } from '@org/ai';
import { ClaudeInteractiveAIProvider } from '@org/claude';
import { GeminiInteractiveAIProvider } from '@org/gemini';
import { loadEnvironment } from '../config/environment';
import { ProductionAdaptersModule } from './production-adapters.module';

/** Le fournisseur d'IA que les adaptateurs de production branchent, d'après la configuration. */
async function aiProviderFor(variables: Record<string, string>): Promise<InteractiveAIProvider> {
  const environment = loadEnvironment({
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    SUPABASE_SECRET_KEY: 'secret',
    WORKFLOW_STATE_STORE: 'memory',
    ...variables,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ProductionAdaptersModule.register(environment)],
  }).compile();

  return moduleRef.get(InteractiveAIProvider);
}

describe('ProductionAdaptersModule', () => {
  it('branche Gemini par défaut', async () => {
    await expect(aiProviderFor({ GEMINI_API_KEY: 'gemini' })).resolves.toBeInstanceOf(
      GeminiInteractiveAIProvider,
    );
  });

  it('branche Claude quand AI_PROVIDER=claude', async () => {
    await expect(
      aiProviderFor({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test' }),
    ).resolves.toBeInstanceOf(ClaudeInteractiveAIProvider);
  });
});
