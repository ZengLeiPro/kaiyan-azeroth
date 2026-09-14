import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceList } from './evidence-view';

function documentEvidence(url: unknown): unknown {
  return [{ type: 'doc', title: '文档证据', url }];
}

afterEach(() => cleanup());

describe('EvidenceList document links', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '//example.com/doc',
    'https://user:password@example.com/doc',
    'https://example.com/path\\doc',
    'https://example.com/%255Cdoc',
    'https://example.com/%',
    'https://example.com/%ZZ',
    'https://example.com/%25ZZ',
    'https://example.com/%00',
    'https://example.com/%0d%0aevil',
    'https://example.com/%250Aevil',
    'https://example.com/%E2%80%8Bhidden',
    'https://example.com/%25E2%2580%258Bhidden',
    'https://example.com/%E2%80%AEhidden',
    'https://example.com/%E2%81%A0hidden',
    'https://example.com/\u200bhidden',
    'https://example.com/\u202ehidden',
    'https://example.com/\u2060hidden',
    'https://例子.测试/doc',
    ' https://example.com/doc',
    'https://example.com/doc ',
  ])('renders unsafe URL %j as title-only text without any href', (url) => {
    const { container } = render(<EvidenceList evidence={documentEvidence(url)} />);

    expect(screen.getByText('文档证据').tagName).toBe('SPAN');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
  });

  it.each([
    ['http://127.0.0.1:8080/doc', 'http://127.0.0.1:8080/doc'],
    [
      'HTTPS://EXAMPLE.COM:443/doc?q=a%20b&next=%2Fcrm#section',
      'https://example.com/doc?q=a%20b&next=%2Fcrm#section',
    ],
    ['https://[2001:db8::1]:8443/doc?q=1#section', 'https://[2001:db8::1]:8443/doc?q=1#section'],
    ['https://example.com/%FF', 'https://example.com/%FF'],
    ['https://example.com/%D6%D0%CE%C4', 'https://example.com/%D6%D0%CE%C4'],
  ])('renders safe URL %j as the canonical hardened external link', (url, expected) => {
    render(<EvidenceList evidence={documentEvidence(url)} />);

    const link = screen.getByRole('link', { name: '文档证据' });
    expect(link.getAttribute('href')).toBe(expected);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('rebuilds non-doc evidence from safe text fields and never honors an extra url', () => {
    const { container } = render(
      <EvidenceList
        evidence={[
          {
            type: 'crm',
            table: 'customer',
            excerpt: '30 天无跟进',
            url: 'javascript:alert(1)',
            extra: { href: 'https://evil.example' },
          },
        ]}
      />
    );

    expect(screen.getByText('30 天无跟进')).toBeTruthy();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
  });

  it.each([
    [{ type: 'unknown', title: '未知证据', url: 'https://example.com' }],
    [{ type: 'doc', url: 'https://example.com' }],
    [{ type: 'crm', table: { unsafe: true }, excerpt: ['not text'] }],
    'not-an-array',
  ])('renders unknown or malformed evidence %# only as the safe empty-state text', (evidence) => {
    const { container } = render(<EvidenceList evidence={evidence} />);

    expect(screen.getByText('暂无关联证据')).toBeTruthy();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
  });
});
