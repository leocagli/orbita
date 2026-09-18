// Esquema de Órbita. Ningún dominio visitado ni dato personal del adolescente:
// solo alias, tokens hasheados, conteos por semana y el registro de consentimientos.
// Va como string para que el bundle de Vercel lo incluya.

export const ESQUEMA = `
create table if not exists adultos (
  id text primary key,
  alias text not null,
  token_hash text not null unique,
  push_token text,
  creado timestamptz not null default now()
);

create table if not exists dispositivos (
  id text primary key,
  alias text not null,
  token_hash text not null unique,
  version_app text,
  proteccion_activa boolean not null default true,
  ultimo_latido timestamptz,
  creado timestamptz not null default now()
);

create table if not exists codigos (
  codigo text primary key,
  adulto_id text not null references adultos(id),
  expira timestamptz not null,
  usado boolean not null default false
);

create table if not exists vinculos (
  id text primary key,
  adulto_id text not null references adultos(id),
  dispositivo_id text not null references dispositivos(id),
  estado text not null check (estado in ('activo', 'revocado')),
  revocado_por text check (revocado_por in ('adulto', 'adolescente')),
  creado timestamptz not null default now(),
  revocado timestamptz,
  unique (adulto_id, dispositivo_id)
);

-- El teléfono deduplica y suma; acá solo se guarda el total por semana ISO.
create table if not exists pausas_semana (
  dispositivo_id text not null references dispositivos(id),
  semana text not null,
  cantidad integer not null check (cantidad >= 0),
  actualizado timestamptz not null default now(),
  primary key (dispositivo_id, semana)
);

create table if not exists avisos (
  id text primary key,
  adulto_id text not null references adultos(id),
  tipo text not null,
  texto text not null,
  creado timestamptz not null default now(),
  enviado_por text,
  enviado timestamptz,
  clave_unica text unique
);

-- Solo agregado. Cada fila encadena el hash de la anterior y va firmada con HMAC.
create table if not exists registro_consentimientos (
  n bigserial primary key,
  sujeto_tipo text not null check (sujeto_tipo in ('adulto', 'adolescente')),
  sujeto_id text not null,
  accion text not null check (accion in ('otorgado', 'asentido', 'revocado')),
  version integer not null,
  texto_hash text not null,
  contexto text,
  ts timestamptz not null,
  hash_previo text,
  hash text not null unique,
  firma text not null
);
`;
