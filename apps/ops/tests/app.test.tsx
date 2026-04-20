import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { Layout, LayoutShell } from '../src/components/Layout';
import { StatusBadge } from '../src/components/StatusBadge';

test('StatusBadge renders a human readable status label', () => {
  const markup = renderToStaticMarkup(<StatusBadge status="review_pending" />);
  assert.match(markup, /review pending/i);
});

test('Layout surfaces the workflow-first navigation labels', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/runs']}>
      <Layout />
    </MemoryRouter>
  );

  assert.match(markup, /Overview/i);
  assert.match(markup, /Runs/i);
  assert.match(markup, /Review/i);
  assert.match(markup, /Operations Console/i);
});

test('LayoutShell renders a collapsed sidebar state with accessible nav labels', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/runs']}>
      <LayoutShell initialCollapsed />
    </MemoryRouter>
  );

  assert.match(markup, /shell-collapsed/i);
  assert.match(markup, /Collapse sidebar|Expand sidebar/i);
  assert.match(markup, /aria-label="Runs"/i);
});
