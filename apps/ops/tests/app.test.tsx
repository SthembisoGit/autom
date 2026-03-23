import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatusBadge } from '../src/components/StatusBadge';

test('StatusBadge renders a human readable status label', () => {
  const markup = renderToStaticMarkup(<StatusBadge status="review_pending" />);
  assert.match(markup, /review pending/i);
});
