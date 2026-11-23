console.log(
  "[ENV DEBUG]",
  process.env.NEXT_PUBLIC_ASSISTANT_API_BASE,
  process.env.NEXT_PUBLIC_API_ORIGIN,
  process.env.NEXT_PUBLIC_API_URL
);

type RequiredEnvKey =
  | "NEXT_PUBLIC_API_URL"
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY";

type RequiredEnvValues = Readonly<{
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}>;

type EnvConfig = Readonly<{
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  openAiApiKey: string | null;
}>;

type EnvOptionalConfig = Readonly<{
  apiUrl: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  openAiApiKey: string | null;
}>;

const readEnvValue = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const throwMissingEnvError = (missingKeys: readonly RequiredEnvKey[]): never => {
  const title =
    missingKeys.length === 1
      ? "Missing required environment variable"
      : "Missing required environment variables";
  const formattedKeys = missingKeys.map((key) => `  • ${key}`).join("\n");
  const guidance =
    'Provide the missing value(s) via your deployment configuration or a local ".env.local" file.';
  throw new Error(`${title}:\n${formattedKeys}\n\n${guidance}`);
};

const collectRequiredEnvValues = (): RequiredEnvValues => {
  const missingKeys: RequiredEnvKey[] = [];

  const apiUrl = readEnvValue(process.env.NEXT_PUBLIC_API_URL);
  if (!apiUrl) {
    missingKeys.push("NEXT_PUBLIC_API_URL");
  }

  const supabaseUrl = readEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!supabaseUrl) {
    missingKeys.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  const supabaseAnonKey = readEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseAnonKey) {
    missingKeys.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (missingKeys.length > 0) {
    throwMissingEnvError(missingKeys);
  }

  return Object.freeze({
    apiUrl: apiUrl as string,
    supabaseUrl: supabaseUrl as string,
    supabaseAnonKey: supabaseAnonKey as string,
  });
};

const buildStrictEnvConfig = (): EnvConfig => {
  const requiredEnvValues = collectRequiredEnvValues();
  return Object.freeze({
    apiUrl: requiredEnvValues.apiUrl,
    supabaseUrl: requiredEnvValues.supabaseUrl,
    supabaseAnonKey: requiredEnvValues.supabaseAnonKey,
    openAiApiKey: readEnvValue(process.env.OPENAI_API_KEY),
  });
};

const getStrictEnv = (() => {
  let memo: EnvConfig | null = null;
  return () => {
    if (!memo) {
      memo = buildStrictEnvConfig();
    }
    return memo;
  };
})();

export const envStrict: Readonly<EnvConfig> = new Proxy(
  {},
  {
    get(_, prop) {
      const strictEnv = getStrictEnv();
      if (typeof prop === "symbol") {
        return Reflect.get(strictEnv, prop);
      }
      return strictEnv[prop as keyof EnvConfig];
    },
  }
) as Readonly<EnvConfig>;

export const envOptional: EnvOptionalConfig = Object.freeze({
  apiUrl: readEnvValue(process.env.NEXT_PUBLIC_API_URL),
  supabaseUrl: readEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: readEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  openAiApiKey: readEnvValue(process.env.OPENAI_API_KEY),
});

export const env = envOptional;
