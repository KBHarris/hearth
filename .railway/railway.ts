import { readFileSync } from 'node:fs';
import { bucket, database, defineRailway, project, ref, service, volume } from 'railway/iac';
import type { ResourceNode } from 'railway/iac';
import { validateSettings } from '../deploy/railway/settings.mjs';

// Public, reviewed settings are stable across retries; secrets stay on Railway.
export function hearthProject(input: unknown) {
  const settings = validateSettings(input);
  const db = database('postgres', 'postgres', {
    image: 'ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:fcc6686a3f4f1962fe4ed77a15884553b7bd611ae1cea3204687968c5c09d517',
    defaultMountPath: '/var/lib/postgresql/data', region: settings.region,
  });
  db.networking = { tcpProxies: {}, serviceDomains: {}, customDomains: {} };
  db.variables = { PGDATA: { type: 'literal', value: '/var/lib/postgresql/data/pgdata' } };
  const objects = bucket('attachments', { region: settings.bucketRegion });
  const data = volume('server-data', { region: settings.region, sizeMB: settings.volumeSizeMB });
  const origins = ['http://tauri.localhost', 'tauri://localhost', ...settings.extraClientOrigins];
  if (settings.web) origins.push('https://${{web.RAILWAY_PUBLIC_DOMAIN}}');
  const backend = service('hearth', {
    root: '/',
    build: { builder: 'DOCKERFILE', dockerfilePath: 'crates/hearth-server/Dockerfile' },
    healthcheck: '/health', healthcheckTimeout: 120,
    regions: { [settings.region]: 1 },
    deploy: { requiredMountPath: '/var/lib/hearth', restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
    volumeMounts: { '/var/lib/hearth': data },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      HEARTH_BIND: '[::]:8080', PORT: '8080',
      HEARTH_SERVER_KEY_PATH: '/var/lib/hearth/server.key',
      HEARTH_SERVER_NAME: '${{hearth.RAILWAY_PUBLIC_DOMAIN}}',
      HEARTH_FEDERATION: 'false', HEARTH_CLIENT_ORIGINS: origins.join(','),
      HEARTH_S3_ENDPOINT: ref(objects, 'ENDPOINT'),
      HEARTH_S3_PUBLIC_ENDPOINT: ref(objects, 'ENDPOINT'),
      HEARTH_S3_BUCKET: ref(objects, 'BUCKET'), HEARTH_S3_REGION: ref(objects, 'REGION'),
      HEARTH_S3_ACCESS_KEY: ref(objects, 'ACCESS_KEY_ID'), HEARTH_S3_SECRET_KEY: ref(objects, 'SECRET_ACCESS_KEY'),
      HEARTH_S3_URL_STYLE: 'virtual-hosted', HEARTH_S3_CREATE_BUCKET: 'false', RUST_LOG: 'info',
    },
  });
  const resources: ResourceNode[] = [db, objects, data, backend];
  if (settings.web) resources.push(service('web', {
    root: '/', build: { builder: 'DOCKERFILE', dockerfilePath: 'deploy/web/Dockerfile' },
    healthcheck: '/web-health', healthcheckTimeout: 120,
    regions: { [settings.region]: 1 },
    env: { PORT: '8080', HEARTH_BACKEND_UPSTREAM: '${{hearth.RAILWAY_PRIVATE_DOMAIN}}:8080' },
  }));
  return project(settings.projectName, { resources });
}

export default defineRailway(() => hearthProject(JSON.parse(readFileSync(new URL('./hearth.json', import.meta.url), 'utf8'))));
