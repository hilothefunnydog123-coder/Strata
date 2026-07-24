import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const hash = (p) => bcrypt.hashSync(p, 10);

async function main() {
  const ownerEmail = (process.env.OWNER_EMAIL || "owner@ward.health").toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD || "ward-owner";
  const ownerName = process.env.OWNER_NAME || "Platform Owner";

  // Platform owner (superadmin). Password only set on first creation so an
  // owner who later changes it isn't reset on redeploy.
  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (existingOwner) {
    await prisma.user.update({
      where: { email: ownerEmail },
      data: { isOwner: true, active: true, name: ownerName },
    });
  } else {
    await prisma.user.create({
      data: {
        email: ownerEmail,
        name: ownerName,
        passwordHash: hash(ownerPassword),
        role: "Owner",
        isOwner: true,
        orgId: null,
      },
    });
  }

  // Northstar demo/sandbox organization (shows the fully populated estate).
  const org = await prisma.organization.upsert({
    where: { slug: "northstar-health" },
    update: { seededDemo: true, active: true },
    create: {
      name: "Northstar Health System",
      slug: "northstar-health",
      plan: "Enterprise",
      seededDemo: true,
    },
  });

  const demoUsers = [
    { email: "elena.marsh@northstarhealth.org", name: "Dr. Elena Marsh", role: "AI Governance Lead" },
    { email: "alan.whitmore@northstarhealth.org", name: "Dr. Alan Whitmore", role: "Executive" },
    { email: "james.okonkwo@northstarhealth.org", name: "James Okonkwo", role: "Compliance Officer" },
  ];
  for (const u of demoUsers) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      await prisma.user.update({
        where: { email: u.email },
        data: { name: u.name, role: u.role, orgId: org.id, active: true },
      });
    } else {
      await prisma.user.create({
        data: { email: u.email, name: u.name, role: u.role, orgId: org.id, passwordHash: hash("ward-demo") },
      });
    }
  }

  console.log(`Seed complete. Owner: ${ownerEmail} · Demo org: ${org.name}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
