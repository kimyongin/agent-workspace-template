export function readLocalConfig(file?: string | URL): {
  projectId: string;
  apiUrl: string;
  poolerPort: number;
  webUrl: string;
  webPort: number;
  webOrigins: string;
};
