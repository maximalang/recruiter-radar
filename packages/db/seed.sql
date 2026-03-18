BEGIN;

INSERT INTO users (
  id,
  email,
  full_name,
  telegram_chat_id,
  telegram_username,
  created_at,
  updated_at
)
VALUES
  (
    1,
    'anna.smirnova@example.com',
    'Анна Смирнова',
    7010001001,
    'anna_rr',
    '2026-03-01 09:00:00+03',
    '2026-03-15 10:30:00+03'
  ),
  (
    2,
    'ivan.petrov@example.com',
    'Иван Петров',
    7010001002,
    'ivan_rr',
    '2026-03-02 11:20:00+03',
    '2026-03-16 09:40:00+03'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs (
  id,
  name,
  domain,
  website_url,
  created_at,
  updated_at
)
VALUES
  (
    1,
    'Север Тех',
    'severtech.ru',
    'https://severtech.ru',
    '2026-03-01 10:00:00+03',
    '2026-03-12 11:00:00+03'
  ),
  (
    2,
    'Линия Данных',
    'data-line.io',
    'https://data-line.io',
    '2026-03-01 10:15:00+03',
    '2026-03-13 10:00:00+03'
  ),
  (
    3,
    'Городские Сервисы',
    'gorservice.ru',
    'https://gorservice.ru',
    '2026-03-01 10:30:00+03',
    '2026-03-09 12:45:00+03'
  ),
  (
    4,
    'Nova Retail',
    'novaretail.co',
    'https://novaretail.co',
    '2026-03-01 10:45:00+03',
    '2026-03-07 16:10:00+03'
  ),
  (
    5,
    'Atlas People',
    'atlaspeople.io',
    'https://atlaspeople.io',
    '2026-03-01 11:00:00+03',
    '2026-03-15 13:30:00+03'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscriptions (
  id,
  user_id,
  plan_code,
  status,
  started_at,
  current_period_end,
  cancel_at_period_end,
  created_at,
  updated_at
)
VALUES
  (
    1,
    1,
    'pro_monthly',
    'active',
    '2026-03-01 09:00:00+03',
    '2026-04-01 09:00:00+03',
    FALSE,
    '2026-03-01 09:00:00+03',
    '2026-03-15 10:30:00+03'
  ),
  (
    2,
    2,
    'starter_monthly',
    'trial',
    '2026-03-14 11:00:00+03',
    '2026-03-28 11:00:00+03',
    FALSE,
    '2026-03-14 11:00:00+03',
    '2026-03-16 09:40:00+03'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO signals (
  id,
  org_id,
  signal_type,
  source,
  external_id,
  headline,
  summary,
  source_url,
  occurred_at,
  payload,
  created_at,
  updated_at
)
VALUES
  (
    1,
    1,
    'job_posting',
    'hh',
    'hh-1001',
    'Север Тех открыла позиции Senior Backend Engineer и DevOps',
    'Компания расширяет core-платформу и ищет инженеров в продуктовую команду.',
    'https://hh.ru/vacancy/1001',
    '2026-03-10 09:30:00+03',
    '{"open_roles": 2, "location": "Moscow", "department": "platform"}'::jsonb,
    '2026-03-10 09:35:00+03',
    '2026-03-10 09:35:00+03'
  ),
  (
    2,
    1,
    'team_growth',
    'company_blog',
    'st-growth-202603',
    'Север Тех объявила о расширении команды продаж',
    'В мартовском апдейте компания сообщила о найме в sales и customer success.',
    'https://severtech.ru/blog/march-growth',
    '2026-03-12 11:00:00+03',
    '{"teams": ["sales", "customer success"]}'::jsonb,
    '2026-03-12 11:05:00+03',
    '2026-03-12 11:05:00+03'
  ),
  (
    3,
    2,
    'funding',
    'vc',
    'vc-220',
    'Линия Данных закрыла seed-раунд на 1.2 млн долларов',
    'После инвестиций компания планирует усилить data engineering и аналитический блок.',
    'https://example.com/vc/220',
    '2026-03-08 14:20:00+03',
    '{"round": "seed", "amount_usd": 1200000}'::jsonb,
    '2026-03-08 14:25:00+03',
    '2026-03-08 14:25:00+03'
  ),
  (
    4,
    2,
    'job_posting',
    'linkedin',
    'li-8891',
    'Линия Данных ищет product analyst',
    'Появилась вакансия product analyst для B2B SaaS направления.',
    'https://linkedin.com/jobs/view/8891',
    '2026-03-13 10:00:00+03',
    '{"role": "product analyst", "mode": "hybrid"}'::jsonb,
    '2026-03-13 10:05:00+03',
    '2026-03-13 10:05:00+03'
  ),
  (
    5,
    3,
    'leadership_change',
    'company_blog',
    'gs-cpo-1',
    'Городские Сервисы назначили нового директора по продукту',
    'Новый руководитель отвечает за запуск двух городских сервисов и набор команды.',
    'https://gorservice.ru/news/product-leadership',
    '2026-03-09 12:45:00+03',
    '{"role": "chief product officer"}'::jsonb,
    '2026-03-09 12:50:00+03',
    '2026-03-09 12:50:00+03'
  ),
  (
    6,
    4,
    'job_posting',
    'hh',
    'hh-1044',
    'Nova Retail нанимает account executive в enterprise-направление',
    'Вакансия указывает на расширение продаж и запуск outbound-процессов.',
    'https://hh.ru/vacancy/1044',
    '2026-03-07 16:10:00+03',
    '{"role": "account executive", "segment": "enterprise"}'::jsonb,
    '2026-03-07 16:15:00+03',
    '2026-03-07 16:15:00+03'
  ),
  (
    7,
    5,
    'team_growth',
    'telegram',
    'tg-551',
    'Atlas People собирает команду customer success',
    'В канале компании появились объявления о росте команды внедрения и поддержки.',
    'https://t.me/atlaspeople/551',
    '2026-03-11 09:00:00+03',
    '{"roles": ["customer success manager", "implementation manager"]}'::jsonb,
    '2026-03-11 09:05:00+03',
    '2026-03-11 09:05:00+03'
  ),
  (
    8,
    5,
    'other',
    'website',
    'ap-pricing-1',
    'Atlas People обновила страницу enterprise-тарифов',
    'На сайте появились отдельные тарифы для средних и крупных компаний, что часто сопровождает рост продаж.',
    'https://atlaspeople.io/pricing',
    '2026-03-15 13:30:00+03',
    '{"change": "enterprise pricing page"}'::jsonb,
    '2026-03-15 13:35:00+03',
    '2026-03-15 13:35:00+03'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO leads (
  id,
  user_id,
  org_id,
  status,
  score,
  notes,
  last_signal_at,
  created_at,
  updated_at
)
VALUES
  (
    1,
    1,
    1,
    'saved',
    82,
    'Сильный hiring-сигнал по инженерии и sales, стоит выйти на VP Sales.',
    '2026-03-12 11:00:00+03',
    '2026-03-12 12:00:00+03',
    '2026-03-12 15:00:00+03'
  ),
  (
    2,
    1,
    2,
    'contacted',
    91,
    'После раунда можно писать основателю и Head of Data.',
    '2026-03-13 10:00:00+03',
    '2026-03-08 15:00:00+03',
    '2026-03-14 09:00:00+03'
  ),
  (
    3,
    1,
    4,
    'dismissed',
    54,
    'Не подходит по ICP: retail без явного интереса к recruiting automation.',
    '2026-03-07 16:10:00+03',
    '2026-03-07 18:00:00+03',
    '2026-03-08 11:00:00+03'
  ),
  (
    4,
    2,
    3,
    'new',
    69,
    'Новый CPO, вероятен найм PM и ops-команды в ближайший месяц.',
    '2026-03-09 12:45:00+03',
    '2026-03-09 13:30:00+03',
    '2026-03-09 13:30:00+03'
  ),
  (
    5,
    2,
    5,
    'contacted',
    87,
    'Команда CS растет, можно предложить inbound-рекрутинг и Telegram-алерты.',
    '2026-03-15 13:30:00+03',
    '2026-03-11 10:00:00+03',
    '2026-03-16 10:30:00+03'
  ),
  (
    6,
    2,
    1,
    'saved',
    76,
    'Повторный приоритет для теста второй аудитории.',
    '2026-03-12 11:00:00+03',
    '2026-03-12 16:00:00+03',
    '2026-03-12 16:30:00+03'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO lead_status (
  id,
  lead_id,
  from_status,
  to_status,
  changed_by,
  note,
  created_at
)
VALUES
  (
    1,
    1,
    NULL,
    'new',
    'system',
    'Лид создан после сигнала о вакансиях.',
    '2026-03-12 12:00:00+03'
  ),
  (
    2,
    1,
    'new',
    'saved',
    'user',
    'Добавлен в приоритетный список.',
    '2026-03-12 15:00:00+03'
  ),
  (
    3,
    2,
    NULL,
    'new',
    'system',
    'Лид собран после новости о раунде.',
    '2026-03-08 15:00:00+03'
  ),
  (
    4,
    2,
    'new',
    'contacted',
    'user',
    'Отправлено первое сообщение фаундеру.',
    '2026-03-14 09:00:00+03'
  ),
  (
    5,
    3,
    NULL,
    'dismissed',
    'user',
    'Компания не подходит по сегменту.',
    '2026-03-08 11:00:00+03'
  ),
  (
    6,
    4,
    NULL,
    'new',
    'system',
    'Сигнал на основе смены руководства.',
    '2026-03-09 13:30:00+03'
  ),
  (
    7,
    5,
    NULL,
    'contacted',
    'user',
    'Сообщение отправлено через Telegram после обновления тарифов.',
    '2026-03-16 10:30:00+03'
  ),
  (
    8,
    6,
    NULL,
    'saved',
    'user',
    'Сохранен как запасной лид по Север Тех.',
    '2026-03-12 16:30:00+03'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO deliveries (
  id,
  lead_id,
  user_id,
  telegram_chat_id,
  telegram_message_id,
  status,
  error_message,
  delivered_at,
  created_at,
  updated_at
)
VALUES
  (
    1,
    1,
    1,
    7010001001,
    50101,
    'sent',
    NULL,
    '2026-03-12 12:02:00+03',
    '2026-03-12 12:01:00+03',
    '2026-03-12 12:02:00+03'
  ),
  (
    2,
    2,
    1,
    7010001001,
    50102,
    'sent',
    NULL,
    '2026-03-08 15:05:00+03',
    '2026-03-08 15:01:00+03',
    '2026-03-08 15:05:00+03'
  ),
  (
    3,
    4,
    2,
    7010001002,
    NULL,
    'queued',
    NULL,
    NULL,
    '2026-03-09 13:31:00+03',
    '2026-03-09 13:31:00+03'
  ),
  (
    4,
    5,
    2,
    7010001002,
    NULL,
    'failed',
    'telegram bot was blocked by user',
    NULL,
    '2026-03-16 10:31:00+03',
    '2026-03-16 10:35:00+03'
  )
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('users', 'id'),
  COALESCE((SELECT MAX(id) FROM users), 1),
  TRUE
);

SELECT setval(
  pg_get_serial_sequence('orgs', 'id'),
  COALESCE((SELECT MAX(id) FROM orgs), 1),
  TRUE
);

SELECT setval(
  pg_get_serial_sequence('subscriptions', 'id'),
  COALESCE((SELECT MAX(id) FROM subscriptions), 1),
  TRUE
);

SELECT setval(
  pg_get_serial_sequence('signals', 'id'),
  COALESCE((SELECT MAX(id) FROM signals), 1),
  TRUE
);

SELECT setval(
  pg_get_serial_sequence('leads', 'id'),
  COALESCE((SELECT MAX(id) FROM leads), 1),
  TRUE
);

SELECT setval(
  pg_get_serial_sequence('lead_status', 'id'),
  COALESCE((SELECT MAX(id) FROM lead_status), 1),
  TRUE
);

SELECT setval(
  pg_get_serial_sequence('deliveries', 'id'),
  COALESCE((SELECT MAX(id) FROM deliveries), 1),
  TRUE
);

COMMIT;
