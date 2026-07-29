/**
 * Outbound campaign mechanics.
 *
 * The things worth testing here are the ones that embarrass you in public: a
 * placeholder left unfilled in a real person's inbox, a CSV import that silently
 * drops half a list, and a message that goes out without an unsubscribe link.
 */
import { describe, expect, it } from 'vitest';
import { parseContactsCsv } from '@/lib/email/campaign';
import {
  campaignFooter,
  placeholdersIn,
  substitute,
  unsubscribeUrl,
  type Substitutable,
} from '@/lib/email/substitute';

function target(over: Partial<Substitutable> = {}): Substitutable {
  return {
    firstName: 'Dana',
    lastName: 'Whitfield',
    title: 'Director of Revenue Integrity',
    orgName: 'Mercy Regional Health',
    email: 'dana@mercyregional.test',
    unsubscribeToken: 'tok_abc123',
    ...over,
  };
}

describe('substitute', () => {
  it('fills every supported placeholder', () => {
    const out = substitute(
      '{{first_name}} {{last_name}}, {{title}} at {{org_name}} ({{email}})',
      target(),
    );
    expect(out).toBe(
      'Dana Whitfield, Director of Revenue Integrity at Mercy Regional Health (dana@mercyregional.test)',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substitute('Hello {{ first_name }},', target())).toBe('Hello Dana,');
  });

  it('never leaves a placeholder visible when a field is missing', () => {
    const out = substitute(
      '{{first_name}}, as {{title}} at {{org_name}}',
      target({ firstName: null, title: null, orgName: null }),
    );
    expect(out).not.toContain('{{');
    expect(out).toBe('there, as your role at your organisation');
  });

  it('treats an empty string the same as a missing field', () => {
    expect(substitute('{{first_name}}', target({ firstName: '   ' }))).toBe('there');
  });

  it('leaves an unknown placeholder alone rather than guessing', () => {
    // Better a visible mistake in a preview than a silently wrong substitution.
    expect(substitute('{{not_a_field}}', target())).toBe('{{not_a_field}}');
  });

  it('substitutes every occurrence, not just the first', () => {
    expect(substitute('{{first_name}} and {{first_name}}', target())).toBe(
      'Dana and Dana',
    );
  });
});

describe('placeholdersIn', () => {
  it('lists what a template uses, once each', () => {
    expect(
      placeholdersIn('{{first_name}} at {{org_name}}, hello {{first_name}}').sort(),
    ).toEqual(['first_name', 'org_name']);
  });

  it('returns nothing for a template with no placeholders', () => {
    expect(placeholdersIn('A plain message.')).toEqual([]);
  });
});

describe('campaignFooter', () => {
  it('always carries a working unsubscribe link', () => {
    const footer = campaignFooter(target());
    expect(footer).toContain(unsubscribeUrl('tok_abc123'));
    expect(footer).toContain('/unsubscribe/tok_abc123');
  });

  it('is appended by the system rather than typed into the template', () => {
    // The point of this test is the property, not the string: a composer who
    // forgets the footer still sends a compliant message.
    expect(campaignFooter(target())).toContain('unsubscribe');
  });
});

describe('parseContactsCsv', () => {
  it('reads a normal export', () => {
    const { contacts, errors } = parseContactsCsv(
      [
        'first_name,last_name,email,title,org_name',
        'Dana,Whitfield,dana@mercyregional.test,Director,Mercy Regional',
        'Rosa,Petrucci,rosa@northgate.test,Specialist,Northgate',
      ].join('\n'),
    );

    expect(errors).toEqual([]);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      email: 'dana@mercyregional.test',
      firstName: 'Dana',
      orgName: 'Mercy Regional',
    });
  });

  it('accepts alternative header spellings and any column order', () => {
    const { contacts } = parseContactsCsv(
      ['Company,Work Email,First Name', 'Northgate,ROSA@NORTHGATE.TEST,Rosa'].join('\n'),
    );
    expect(contacts[0]).toMatchObject({
      email: 'rosa@northgate.test',
      firstName: 'Rosa',
      orgName: 'Northgate',
    });
  });

  it('honours quoted fields containing commas', () => {
    const { contacts } = parseContactsCsv(
      ['email,org_name', 'a@b.test,"Mercy Regional Health, Inc."'].join('\n'),
    );
    expect(contacts[0]!.orgName).toBe('Mercy Regional Health, Inc.');
  });

  it('refuses a file with no email column, rather than importing nothing quietly', () => {
    const { contacts, errors } = parseContactsCsv('name,company\nDana,Mercy');
    expect(contacts).toHaveLength(0);
    expect(errors[0]).toContain('No email column');
  });

  it('reports every skipped row with its line number', () => {
    const { contacts, errors } = parseContactsCsv(
      [
        'email,first_name',
        'good@example.test,Ada',
        ',NoEmail',
        'not-an-address,Broken',
        'good@example.test,Duplicate',
      ].join('\n'),
    );

    expect(contacts).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('Row 3');
    expect(errors[1]).toContain('Row 4');
    expect(errors[2]).toContain('Row 5');
    expect(errors[2]).toContain('appears more than once');
  });

  it('lowercases addresses so a duplicate in different case is caught', () => {
    const { contacts, errors } = parseContactsCsv(
      ['email', 'Dana@Example.test', 'dana@example.TEST'].join('\n'),
    );
    expect(contacts).toHaveLength(1);
    expect(errors[0]).toContain('appears more than once');
  });

  it('says so when handed an empty file', () => {
    expect(parseContactsCsv('   ').errors[0]).toBe('That was empty.');
  });
});
