import { App, applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

export type AppFirebaseConfig = {
  projectId: string;
  /**
   * Compte de service. Sans lui, ce sont les identifiants par défaut de l'environnement
   * (`GOOGLE_APPLICATION_CREDENTIALS`, compte de l'hébergeur) ou l'émulateur
   * (`FIRESTORE_EMULATOR_HOST`).
   */
  clientEmail?: string;
  /** La clé privée du compte de service (les `\n` échappés sont acceptés). */
  privateKey?: string;
  /** La base Firestore, si ce n'est pas `(default)`. */
  databaseId?: string;
};

const APP_NAME = 'apex-brain';

/**
 * Firestore côté serveur, avec le SDK Admin : les règles de sécurité ne s'appliquent pas, elles
 * peuvent donc tout refuser aux navigateurs (dans Apex, le SDK client écrivait depuis l'onglet).
 */
export class FirebaseClientDataAccess {
  private readonly app: App;
  private readonly firestore: Firestore;

  constructor(config: AppFirebaseConfig) {
    this.app =
      getApps().find((app) => app.name === APP_NAME) ??
      initializeApp(
        {
          projectId: config.projectId,
          credential:
            config.clientEmail && config.privateKey
              ? cert({
                  projectId: config.projectId,
                  clientEmail: config.clientEmail,
                  privateKey: config.privateKey.replace(/\\n/g, '\n'),
                })
              : applicationDefault(),
        },
        APP_NAME,
      );

    this.firestore = config.databaseId ? getFirestore(this.app, config.databaseId) : getFirestore(this.app);
  }

  get db(): Firestore {
    return this.firestore;
  }
}
