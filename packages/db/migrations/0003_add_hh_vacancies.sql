BEGIN;

CREATE TABLE hh_vacancies (
  id BIGSERIAL PRIMARY KEY,
  hh_vacancy_id TEXT NOT NULL UNIQUE,
  hh_employer_id TEXT,
  employer_name TEXT,
  vacancy_name TEXT NOT NULL,
  area_name TEXT,
  published_at TIMESTAMPTZ,
  alternate_url TEXT,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX hh_vacancies_hh_employer_id_idx
  ON hh_vacancies (hh_employer_id);
CREATE INDEX hh_vacancies_published_at_idx
  ON hh_vacancies (published_at DESC);

CREATE TRIGGER hh_vacancies_set_updated_at
BEFORE UPDATE ON hh_vacancies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
