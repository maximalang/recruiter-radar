#!/usr/bin/env python3
import importlib.util
import os
import pathlib
import subprocess
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
AGENT_PATH = ROOT / 'scripts' / 'operator-mcp' / 'rr-operator-agent.py'
spec = importlib.util.spec_from_file_location('rr_operator_agent', AGENT_PATH)
agent = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(agent)


class OperatorAgentTests(unittest.TestCase):
    def test_scrubs_credentials_and_obvious_pii(self):
        text = (
            'Authorization: Bearer top-secret-token '
            'password=hunter2 api_key=abc123 '
            'postgresql://rr:dbpass@db:5432/app '
            'owner@example.com +7 (999) 123-45-67'
        )
        scrubbed = agent.scrub_text(text)
        self.assertNotIn('top-secret-token', scrubbed)
        self.assertNotIn('hunter2', scrubbed)
        self.assertNotIn('abc123', scrubbed)
        self.assertNotIn('dbpass', scrubbed)
        self.assertNotIn('owner@example.com', scrubbed)
        self.assertNotIn('999) 123', scrubbed)
        self.assertIn('[REDACTED]', scrubbed)
        self.assertIn('[REDACTED_EMAIL]', scrubbed)
        self.assertIn('[REDACTED_PHONE]', scrubbed)

    def test_rejects_unknown_service_and_unknown_action(self):
        with self.assertRaisesRegex(agent.AgentError, 'invalid_service'):
            agent.service_state({'service': 'docker'})
        with self.assertRaisesRegex(agent.AgentError, 'unknown_action'):
            agent.dispatch('execute_shell', {'command': 'id'})

    def test_log_adapter_has_bounded_window_and_fixed_container(self):
        observed = []

        def fake_run(argv, timeout=6, check=False):
            observed.append((argv, timeout, check))
            return type('Proc', (), {'returncode': 0, 'stdout': 'safe line\n', 'stderr': ''})()

        with mock.patch.object(agent, 'run', side_effect=fake_run):
            result = agent.recent_logs({'service': 'web', 'sinceSeconds': 60, 'limit': 1})
        self.assertEqual(result['lineCount'], 1)
        self.assertEqual(
            observed[0][0],
            ['docker', 'logs', '--since', '60s', '--tail', '1', 'recruiter-radar-web-1'],
        )
        with self.assertRaisesRegex(agent.AgentError, 'invalid_limit'):
            agent.recent_logs({'service': 'web', 'limit': 501})
        with self.assertRaisesRegex(agent.AgentError, 'invalid_since'):
            agent.recent_logs({'service': 'web', 'sinceSeconds': 59})

    def test_subprocess_capture_uses_legacy_compatible_kwargs(self):
        completed = subprocess.CompletedProcess(['docker', 'version'], 0, 'ok\n', '')
        with mock.patch.object(agent.subprocess, 'run', return_value=completed) as run_mock:
            result = agent.run(['docker', 'version'], timeout=4)

        self.assertIs(result, completed)
        args, kwargs = run_mock.call_args
        self.assertEqual(args, (['docker', 'version'],))
        self.assertFalse(kwargs['shell'])
        self.assertFalse(kwargs['check'])
        self.assertEqual(kwargs['timeout'], 4)
        self.assertIs(kwargs['stdout'], subprocess.PIPE)
        self.assertIs(kwargs['stderr'], subprocess.PIPE)
        self.assertTrue(kwargs['universal_newlines'])
        self.assertNotIn('capture_output', kwargs)
        self.assertNotIn('text', kwargs)
        self.assertEqual(
            kwargs['env'],
            {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'},
        )

    def test_mutations_are_fail_closed_by_default(self):
        with mock.patch.object(agent, 'MUTATIONS_ENABLED', False):
            with self.assertRaisesRegex(agent.AgentError, 'mutations_disabled'):
                agent.restart_service({
                    'service': 'web',
                    'idempotencyKey': 'restart:test:0001',
                })

    def test_restart_allowlist_excludes_database(self):
        with mock.patch.object(agent, 'MUTATIONS_ENABLED', True):
            with self.assertRaisesRegex(agent.AgentError, 'service_not_restartable'):
                agent.restart_service({
                    'service': 'db',
                    'idempotencyKey': 'restart:test:0002',
                })

    def test_no_shell_execution_or_generic_host_read_contract(self):
        source = AGENT_PATH.read_text(encoding='utf-8')
        self.assertNotIn('shell=True', source)
        self.assertNotIn('capture_output=True', source)
        self.assertNotIn('text=True', source)
        self.assertNotIn('os.system(', source)
        self.assertNotIn('subprocess.Popen(', source)
        self.assertNotIn("action == 'execute_shell'", source)
        self.assertNotIn("action == 'read_file'", source)
        self.assertNotIn("action == 'run_sql'", source)
        self.assertNotIn("action == 'fetch_url'", source)


if __name__ == '__main__':
    unittest.main()
