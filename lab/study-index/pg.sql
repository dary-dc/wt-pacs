-- The study index on PostgreSQL 18, README §Engines: schema.sql's columns in a database whose collation is the
-- builtin C.UTF-8 (code-point order, as ascii_bin), and `name_key`, the patient name folded by `pn_fold`.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE so that a generated column may use it; true while the unaccent rules file does not change.
CREATE FUNCTION pn_fold(text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN lower(public.unaccent('public.unaccent'::regdictionary, $1));

CREATE TABLE study (
  study_uid                text NOT NULL PRIMARY KEY,
  host                     text NOT NULL,
  revision                 bigint NOT NULL,
  access_key               text NOT NULL,
  patient_name             text NOT NULL,
  patient_id               text NOT NULL,
  issuer_of_patient_id     text NOT NULL,
  patient_birth_date       date,
  patient_sex              text,
  study_date               date NOT NULL,
  study_time               time NOT NULL,
  accession_number         text,
  study_id                 text,
  referring_physician_name text,
  modalities_in_study      text,
  study_description        text,
  number_of_series         integer NOT NULL,
  number_of_instances      integer NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  name_key                 text GENERATED ALWAYS AS (pn_fold(patient_name)) STORED
);

CREATE TABLE series (
  series_uid          text NOT NULL PRIMARY KEY,
  study_uid           text NOT NULL,
  modality            text NOT NULL,
  series_number       integer,
  series_description  text,
  number_of_instances integer NOT NULL,
  number_of_frames    integer NOT NULL,
  codec               text NOT NULL
);
