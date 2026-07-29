import type { Metadata } from 'next';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  EmptyState,
  ErrorState,
  Id,
  Money,
  Notice,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Style guide',
  robots: { index: false, follow: false },
};

/**
 * Every component, in every state.
 *
 * Not a gallery. It exists so that a change to a primitive can be checked
 * against all of its states at once, including the ones nobody remembers to
 * look at: the disabled button, the field with an error and a hint together,
 * the table with a negative figure in it.
 *
 * The contrast ratios below were computed rather than estimated. They are
 * printed here so the claim can be checked against the rendered colour rather
 * than taken from a document.
 */
export default function StyleGuide() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl">Style guide</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        Every primitive in every state. The rationale is in DESIGN.md; this is
        the thing you look at when you change one.
      </p>

      <Section title="Colour">
        <p className="mb-4 max-w-2xl text-sm text-ink-2">
          Five values, each carrying exactly one meaning. Contrast is measured
          against the paper ground. Nothing here is decorative: if a colour
          appears in this product, it is telling you something.
        </p>
        <div className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
          <Swatch
            name="ink"
            hex="#12100E"
            ratio="17.6:1"
            meaning="Body text, rules, everything read."
          />
          <Swatch
            name="ink-2"
            hex="#3D3934"
            ratio="10.4:1"
            meaning="Secondary text. Still fully readable, never light grey."
          />
          <Swatch
            name="paper"
            hex="#F6F5F1"
            ratio="ground"
            meaning="The surface everything sits on."
          />
          <Swatch
            name="denied"
            hex="#9B1C1C"
            ratio="7.6:1"
            meaning="Dollars withheld. Deadlines inside seven days. Rejections."
          />
          <Swatch
            name="recovered"
            hex="#0E5540"
            ratio="8.2:1"
            meaning="Dollars returned. Approvals. Verified assertions."
          />
          <Swatch
            name="action"
            hex="#1B4A8F"
            ratio="8.1:1"
            meaning="Interactive elements only. Links, buttons, focus rings."
          />
        </div>
      </Section>

      <Section title="Type">
        <div className="space-y-4">
          <div>
            <Label>Public Sans, interface and data</Label>
            <p className="text-2xl">Recovered to date</p>
            <p className="text-base">
              The plan applied criteria more restrictive than Traditional Medicare.
            </p>
            <p className="text-sm text-ink-2">
              Secondary text at 13 pixels, still measured above 7:1.
            </p>
          </div>
          <div>
            <Label>IBM Plex Mono, identifiers</Label>
            <p className="id">DAB No. 3145</p>
            <p className="id">42 CFR 422.101(b)</p>
            <p className="id">DEN-2026-0184 / 2026-01-04 / 0123456789</p>
          </div>
          <div>
            <Label>Source Serif, documents</Label>
            <p className="document max-w-2xl">
              The Council has consistently held that a Medicare Advantage
              organization may not apply coverage criteria more restrictive than
              those used in Traditional Medicare.
            </p>
          </div>
          <div>
            <Label>Tabular figures, always</Label>
            <Table className="max-w-sm">
              <tbody>
                <tr>
                  <Td numeric>$18,420.00</Td>
                </tr>
                <tr>
                  <Td numeric>$1,111.11</Td>
                </tr>
                <tr>
                  <Td numeric>$999,999.99</Td>
                </tr>
              </tbody>
            </Table>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="space-y-4">
          <Row>
            <Button intent="primary">Generate appeal</Button>
            <Button intent="secondary">Export DOCX</Button>
            <Button intent="danger">Send back</Button>
            <Button intent="quiet">Sign out</Button>
          </Row>
          <Row>
            <Button intent="primary" disabled>
              Generate appeal
            </Button>
            <Button intent="secondary" disabled>
              Export DOCX
            </Button>
            <Button intent="danger" disabled>
              Send back
            </Button>
            <Button intent="quiet" disabled>
              Sign out
            </Button>
          </Row>
          <Row>
            <Button intent="primary" size="sm">
              Small primary
            </Button>
            <Button intent="secondary" size="sm">
              Small secondary
            </Button>
            <ButtonLink href="/styleguide" intent="primary" size="sm">
              Link as button
            </ButtonLink>
          </Row>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
          <Field label="Payer" name="sg-payer">
            {(props) => <Input {...props} defaultValue="Meridian Health" />}
          </Field>
          <Field label="Your reference" name="sg-ref" required hint="However you track it.">
            {(props) => <Input {...props} className="id" defaultValue="DEN-2026-0184" />}
          </Field>
          <Field
            label="Amount denied"
            name="sg-amount"
            required
            error="Enter an amount like 18420.00, with no currency symbol."
          >
            {(props) => <Input {...props} className="id" invalid defaultValue="$18,420" />}
          </Field>
          <Field label="Service" name="sg-service">
            {(props) => (
              <Select {...props} defaultValue="skilled_nursing">
                <option value="skilled_nursing">Skilled nursing facility</option>
                <option value="inpatient_rehab">Inpatient rehabilitation</option>
              </Select>
            )}
          </Field>
          <Field label="Disabled" name="sg-disabled">
            {(props) => <Input {...props} disabled defaultValue="Cannot change this" />}
          </Field>
          <Field label="Notes" name="sg-notes" hint="Shown to the specialist verbatim.">
            {(props) => <Textarea {...props} rows={3} />}
          </Field>
        </div>
      </Section>

      <Section title="Money and identifiers">
        <Row>
          <Money cents={1842000} />
          <Money cents={1842000} tone="denied" />
          <Money cents={1842000} tone="recovered" />
          <Money cents={1842000} whole />
          <Money cents={0} tone="recovered" />
          <Id>DAB No. 3145</Id>
        </Row>
      </Section>

      <Section title="Tags">
        <Row>
          <Tag>Clinical review</Tag>
          <Tag tone="denied">Rejected</Tag>
          <Tag tone="recovered">Approved</Tag>
          <Tag tone="action">Authority</Tag>
        </Row>
      </Section>

      <Section title="Notices and states">
        <div className="max-w-2xl space-y-4">
          <Notice>Nothing has changed since you last looked.</Notice>
          <Notice tone="recovered">
            Approved. Both reviews are complete, so this can now be exported.
          </Notice>
          <Notice tone="denied">
            This environment is not approved for patient information.
          </Notice>
          <ErrorState
            title="Not drafted"
            body="Three drafts in a row contained an assertion whose quote was not in the source it cited. Nothing was saved."
          />
          <Panel>
            <PanelHeader title="Empty state" />
            <EmptyState
              title="No denials yet"
              body="Upload a denial letter and the record that goes with it, and you get back a drafted appeal with every claim traced to its source."
              action={{ href: '/styleguide', label: 'Add a denial' }}
            />
          </Panel>
        </div>
      </Section>

      <Section title="Tables">
        <Panel>
          <PanelHeader title="4 cases">
            <span className="text-2xs text-ink-2">Sorted by deadline</span>
          </PanelHeader>
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Payer</Th>
                <Th numeric>Amount</Th>
                <Th>Deadline</Th>
                <Th>Stage</Th>
                <Th numeric>Recovered</Th>
              </tr>
            </thead>
            <tbody>
              {[
                ['DEN-2026-0184', 'Meridian Health', 1842000, '2026-02-04', 3, 0],
                ['DEN-2026-0179', 'Coastal Advantage', 940050, '2026-02-19', 18, 0],
                ['DEN-2026-0142', 'Meridian Health', 2210000, '2026-03-02', 44, 2210000],
                ['DEN-2026-0118', 'Northbay Senior', 331125, '2026-03-14', 56, 165500],
              ].map(([ref, payer, amount, deadline, days, recovered]) => (
                <tr key={String(ref)} className="hover:bg-paper">
                  <Td>
                    <span className="id">{ref}</span>
                  </Td>
                  <Td>{payer}</Td>
                  <Td numeric>
                    <Money cents={Number(amount)} tone="denied" />
                  </Td>
                  <Td>
                    <span className={Number(days) <= 7 ? 'text-denied' : ''}>
                      <span className="id">{deadline}</span>
                      <span className="ml-1.5 text-xs">{String(days)}d</span>
                    </span>
                  </Td>
                  <Td>
                    <Tag tone={Number(recovered) > 0 ? 'recovered' : 'neutral'}>
                      {Number(recovered) > 0 ? 'Decided' : 'Clinical review'}
                    </Tag>
                  </Td>
                  <Td numeric>
                    {Number(recovered) > 0 ? (
                      <Money cents={Number(recovered)} tone="recovered" />
                    ) : (
                      <span className="text-ink-2">-</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </Section>

      <Section title="The hero figure">
        <p className="text-2xs uppercase tracking-widest text-ink-2">
          Recovered to date
        </p>
        <p className="tnum mt-1 text-6xl font-semibold leading-none text-recovered sm:text-7xl">
          $1,284,900
        </p>
        <p className="mt-2 text-sm text-ink-2">
          One number leads. Everything else on the dashboard is set at a fraction
          of this size.
        </p>
      </Section>

      <Section title="Focus">
        <p className="mb-3 max-w-2xl text-sm text-ink-2">
          Tab through this row. Every interactive element takes a visible
          2 pixel outline in the action colour at 2 pixels offset, switching to
          paper on elements that are already the action colour.
        </p>
        <Row>
          <Button intent="primary">Focusable primary</Button>
          <Button intent="secondary">Focusable secondary</Button>
          <a href="/styleguide">A link</a>
          <Input className="w-48" defaultValue="An input" />
        </Row>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rule-t mt-10 pt-6">
      <h2 className="mb-4 text-2xs font-semibold uppercase tracking-widest text-ink-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-2xs uppercase tracking-wider text-ink-2">{children}</p>
  );
}

function Swatch({
  name,
  hex,
  ratio,
  meaning,
}: {
  name: string;
  hex: string;
  ratio: string;
  meaning: string;
}) {
  return (
    <div className="bg-paper-2 p-3">
      <div
        className="h-10 w-full border border-rule"
        style={{ background: hex }}
        aria-hidden="true"
      />
      <p className="id mt-2 text-xs font-semibold">{name}</p>
      <p className="id text-xs text-ink-2">
        {hex} · {ratio}
      </p>
      <p className="mt-1 text-xs text-ink-2">{meaning}</p>
    </div>
  );
}
