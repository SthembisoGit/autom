import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultProfile } from '../src/lib/default-profile.js';
import { GoogleNewsRssProvider } from '../src/providers/news-provider.js';

test('GoogleNewsRssProvider discovers a filtered daily news topic from rss items', async () => {
  const profile = createDefaultProfile();
  const provider = new GoogleNewsRssProvider(async () => {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title><![CDATA[Nvidia launches new AI chip for enterprise demand - Reuters]]></title>
            <link>https://example.com/nvidia-chip</link>
            <description><![CDATA[<p>The company announced a new enterprise AI chip after strong demand.</p>]]></description>
            <pubDate>Wed, 16 Apr 2026 08:00:00 GMT</pubDate>
          </item>
          <item>
            <title><![CDATA[Celebrity gossip round-up - Example]]></title>
            <link>https://example.com/gossip</link>
            <description><![CDATA[<p>This should be filtered by policy.</p>]]></description>
            <pubDate>Wed, 16 Apr 2026 09:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'application/rss+xml',
        },
      }
    );
  });

  const article = await provider.discoverTopic(profile, new Date('2026-04-16T10:00:00.000Z'));

  assert.ok(article);
  assert.equal(article?.title, 'Nvidia launches new AI chip for enterprise demand');
  assert.equal(article?.sourceName, 'Reuters');
  assert.equal(article?.query, 'technology news');
  assert.match(article?.snippet ?? '', /enterprise AI chip/i);
});
