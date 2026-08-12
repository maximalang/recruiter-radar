export async function runPublicAtsSource(adapter, argv = process.argv.slice(2)) {
  const previousFilter = process.env.CAREER_PAGES_ADAPTER_FILTER;
  process.env.CAREER_PAGES_ADAPTER_FILTER = adapter;

  try {
    const { runCareerPagesCli } = await import('../source-career-pages.mjs');
    await runCareerPagesCli(argv);
  } finally {
    if (previousFilter === undefined) delete process.env.CAREER_PAGES_ADAPTER_FILTER;
    else process.env.CAREER_PAGES_ADAPTER_FILTER = previousFilter;
  }
}
