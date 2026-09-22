import { createRequire } from "node:module";
import type { StorageProvider } from "./provider.js";

interface EcsCredential {
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
}

interface CredentialClient {
  getCredential(): Promise<EcsCredential>;
}

interface OssClient {
  put(key: string, data: Buffer): Promise<unknown>;
  get(key: string): Promise<{ content: Buffer | Uint8Array }>;
  delete(key: string): Promise<unknown>;
}

interface OssClientOptions {
  region: string;
  bucket: string;
  internal: boolean;
  secure: boolean;
  accessKeyId: string;
  accessKeySecret: string;
  stsToken: string;
  refreshSTSToken: () => Promise<{
    accessKeyId: string;
    accessKeySecret: string;
    stsToken: string;
  }>;
}

type CredentialConstructor = new (options: Record<string, unknown>) => CredentialClient;
type OssConstructor = new (options: OssClientOptions) => OssClient;

export interface OSSStorageOptions {
  region: string;
  bucket: string;
  prefix?: string;
  internal?: boolean;
  roleName?: string;
  disableIMDSv1?: boolean;
  clientFactory?: () => Promise<OssClient>;
}

const require = createRequire(import.meta.url);

function normalizePrefix(prefix: string | undefined): string {
  const normalized = (prefix ?? "").replace(/^\/+|\/+$/g, "");
  return normalized.length === 0 ? "" : `${normalized}/`;
}

function requireStorageKey(key: string): string {
  if (key.length === 0 || key.startsWith("/") || key.includes("..")) {
    throw new Error("OSS storage key must be a non-empty relative key without '..'.");
  }
  return key;
}

function requireTemporaryCredential(value: EcsCredential) {
  if (!value.accessKeyId || !value.accessKeySecret || !value.securityToken) {
    throw new Error("ECS RAM role did not return a complete temporary credential.");
  }
  return {
    accessKeyId: value.accessKeyId,
    accessKeySecret: value.accessKeySecret,
    stsToken: value.securityToken,
  };
}

async function createEcsRoleClient(options: OSSStorageOptions): Promise<OssClient> {
  const credentialsModule = require("@alicloud/credentials") as {
    default: CredentialConstructor;
  };
  const ossModule = require("ali-oss") as OssConstructor;
  const Credential = credentialsModule.default;
  const credentialClient = new Credential({
    type: "ecs_ram_role",
    roleName: options.roleName || undefined,
    enableIMDSv2: true,
    disableIMDSv1: options.disableIMDSv1 ?? true,
  });
  const refresh = async () =>
    requireTemporaryCredential(await credentialClient.getCredential());
  const initial = await refresh();

  return new ossModule({
    region: options.region,
    bucket: options.bucket,
    internal: options.internal ?? true,
    secure: true,
    ...initial,
    refreshSTSToken: refresh,
  });
}

export class OSSStorageProvider implements StorageProvider {
  private readonly prefix: string;
  private readonly createClient: () => Promise<OssClient>;
  private clientPromise: Promise<OssClient> | null = null;

  constructor(options: OSSStorageOptions) {
    if (!options.region || !options.bucket) {
      throw new Error("OSS region and bucket are required.");
    }
    this.prefix = normalizePrefix(options.prefix);
    this.createClient = options.clientFactory ?? (() => createEcsRoleClient(options));
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const client = await this.client();
    await client.put(this.objectKey(key), Buffer.from(data));
  }

  async get(key: string): Promise<Uint8Array | null> {
    const client = await this.client();
    try {
      const result = await client.get(this.objectKey(key));
      return new Uint8Array(result.content);
    } catch (error) {
      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code;
      if (status === 404 || code === "NoSuchKey") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const client = await this.client();
    await client.delete(this.objectKey(key));
  }

  private objectKey(key: string): string {
    return `${this.prefix}${requireStorageKey(key)}`;
  }

  private client(): Promise<OssClient> {
    this.clientPromise ??= this.createClient();
    return this.clientPromise;
  }
}
