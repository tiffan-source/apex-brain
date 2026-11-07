import baseConfig, { allowBffImports } from '../../eslint.config.mjs';

// L'infrastructure implémente les lectures BFF des domaines.
export default [...baseConfig, allowBffImports];
