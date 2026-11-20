'use strict';
/**
 * Business vocabulary: service types, statuses and the document checklist
 * each service type needs. Emails and admin screens are driven from here.
 *
 * category: 'pet' (pet travel) or 'freight' (goods / cargo)
 * mode:     'air' (needs an airline AWB before "scheduled"), 'sea', 'ground' or 'none'
 */

const SERVICE_TYPES = {
  domestic_ground: {
    label: 'Domestic Ground Transport', short: 'Pet ground', icon: 'fa-van-shuttle', category: 'pet', mode: 'ground', slug: 'ground',
    blurb: 'Door-to-door pet transport by climate-controlled vehicle within the U.S.',
  },
  domestic_air: {
    label: 'Domestic Air Transport', short: 'Pet domestic air', icon: 'fa-plane', category: 'pet', mode: 'air', slug: 'domestic-air',
    blurb: 'Airline-booked pet travel between U.S. airports, with pickup and delivery.',
  },
  international_air: {
    label: 'International Pet Relocation', short: 'Pet international', icon: 'fa-earth-americas', category: 'pet', mode: 'air', slug: 'international',
    blurb: 'Export paperwork, airline booking and arrival coordination for moves abroad.',
  },
  ocean_freight: {
    label: 'Ocean Freight', short: 'Ocean freight', icon: 'fa-ship', category: 'freight', mode: 'sea', slug: 'ocean-freight',
    blurb: 'Full and shared containers, with coordinated port handling and onward delivery.',
  },
  air_freight: {
    label: 'Air Freight', short: 'Air freight', icon: 'fa-plane-departure', category: 'freight', mode: 'air', slug: 'air-freight',
    blurb: 'Air freight for urgent cargo, from pickup and flight planning to delivery.',
  },
  cargo_freight: {
    label: 'Cargo Freight', short: 'Cargo freight', icon: 'fa-truck-moving', category: 'freight', mode: 'ground', slug: 'cargo-freight',
    blurb: 'Road and multimodal transport for pallets, commercial goods, equipment and general cargo.',
  },
  express_delivery: {
    label: 'Express Delivery', short: 'Express', icon: 'fa-bolt', category: 'freight', mode: 'ground', slug: 'express-delivery',
    blurb: 'Priority delivery for urgent documents, parcels, parts and business shipments.',
  },
  customs_clearance: {
    label: 'Customs Clearance', short: 'Customs', icon: 'fa-file-shield', category: 'freight', mode: 'none', slug: 'customs-clearance',
    blurb: 'Document review and clearance coordination for cross-border shipments.',
  },
  project_cargo: {
    label: 'Project Cargo', short: 'Project cargo', icon: 'fa-industry', category: 'freight', mode: 'ground', slug: 'project-cargo',
    blurb: 'Specialist planning for heavy, oversized, valuable or complex cargo.',
  },
};

const SERVICE_BY_SLUG = Object.fromEntries(Object.entries(SERVICE_TYPES).map(([k, s]) => [s.slug, k]));
const servicesIn = (category) => Object.fromEntries(Object.entries(SERVICE_TYPES).filter(([, s]) => s.category === category));
const PET_SERVICES = servicesIn('pet');
const FREIGHT_SERVICES = servicesIn('freight');
const isFreight = (svc) => SERVICE_TYPES[svc] && SERVICE_TYPES[svc].category === 'freight';
const isAir = (svc) => SERVICE_TYPES[svc] && SERVICE_TYPES[svc].mode === 'air';

/** The two kinds of shipment. Service `category` values map to these. */
const SHIPMENT_KINDS = {
  pet: { label: 'Pet transport', short: 'Pet', icon: 'fa-paw', question: 'A pet', blurb: 'Dogs, cats, birds and other animals, by road or air.' },
  freight: { label: 'Item shipment', short: 'Item', icon: 'fa-box', question: 'An item', blurb: 'Parcels, documents, pallets, containers and other goods.' },
};
const kindOf = (svc) => (SERVICE_TYPES[svc] ? SERVICE_TYPES[svc].category : null);
/** Accepts 'pet' | 'item' | 'freight' (URL friendly 'item' maps to 'freight'). */
const parseKind = (v) => (v === 'pet' ? 'pet' : v === 'item' || v === 'freight' ? 'freight' : null);

const PACKAGE_TYPES = {
  envelope: 'Envelope / documents',
  box: 'Box / parcel',
  pallet: 'Pallet',
  crate: 'Wooden crate',
  container: 'Shipping container',
  machinery: 'Machinery / equipment',
  vehicle: 'Vehicle',
  other: 'Other',
};

const PET_TYPES = {
  dog: 'Dog',
  cat: 'Cat',
  bird: 'Bird',
  small_mammal: 'Small mammal (rabbit, ferret, etc.)',
  other: 'Other',
};
/** Freight bookings store item type 'cargo'. Use ITEM_LABELS to display either. */
const CARGO = 'cargo';
const ITEM_LABELS = { ...PET_TYPES, cargo: 'Cargo' };

const QUOTE_STATUSES = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quote sent',
  converted: 'Converted to booking',
  declined: 'Declined / closed',
};

/** Booking lifecycle. Order matters: it drives the progress bar on the status page. */
const BOOKING_STATUSES = {
  confirmed: { label: 'Booking confirmed', icon: 'fa-circle-check', customer: 'Your booking is confirmed and we are preparing the plan.' },
  documents_pending: { label: 'Waiting on documents', icon: 'fa-file-medical', customer: 'We are waiting on some documents. See the checklist below.' },
  documents_complete: { label: 'Documents complete', icon: 'fa-file-circle-check', customer: 'All required documents have been received and reviewed.' },
  scheduled: { label: 'Transport scheduled', icon: 'fa-calendar-check', customer: 'Transport is scheduled. Details are below.' },
  completed: { label: 'Delivered', icon: 'fa-house-chimney', customer: 'The shipment has been delivered. Thank you for choosing us.' },
  cancelled: { label: 'Cancelled', icon: 'fa-ban', customer: 'This booking has been cancelled.' },
};
const BOOKING_FLOW = ['confirmed', 'documents_pending', 'documents_complete', 'scheduled', 'completed'];

/** Document checklist per service type. */
const DOCUMENTS = {
  domestic_ground: [
    ['rabies', 'Current rabies vaccination certificate'],
    ['vaccines', 'Vaccination records'],
    ['vet_contact', 'Veterinarian contact details'],
    ['feeding', 'Feeding & medication instructions'],
  ],
  domestic_air: [
    ['rabies', 'Current rabies vaccination certificate'],
    ['health_cert', 'Health certificate (CVI) issued within airline time limits (usually 10 days)'],
    ['crate', 'Airline-compliant (IATA) travel crate, measured for your pet'],
    ['acclimation', 'Acclimation certificate, if required by the airline'],
    ['feeding', 'Feeding & medication instructions'],
  ],
  international_air: [
    ['microchip', 'ISO-compliant microchip number'],
    ['rabies', 'Rabies vaccination certificate (after microchip)'],
    ['titer', 'Rabies titer test results, if required by destination'],
    ['import_permit', 'Import permit, if required by destination'],
    ['health_cert', 'International health certificate'],
    ['usda', 'USDA APHIS endorsement of health certificate'],
    ['crate', 'Airline-compliant (IATA) travel crate, measured for your pet'],
    ['owner_id', 'Copy of owner passport / ID'],
  ],
  ocean_freight: [
    ['invoice', 'Commercial invoice'],
    ['packing_list', 'Packing list (packages, weights, dimensions)'],
    ['export_filing', 'Export filing (EEI) details, if required'],
    ['permits', 'Permits or certificates for regulated goods, if required'],
  ],
  air_freight: [
    ['invoice', 'Commercial invoice'],
    ['packing_list', 'Packing list (packages, weights, dimensions)'],
    ['dg_declaration', 'Dangerous goods declaration, if applicable'],
    ['export_filing', 'Export filing (EEI) details, if required'],
  ],
  cargo_freight: [
    ['packing_list', 'Packing list (pallets, weights, dimensions)'],
    ['pickup_contact', 'Pickup site contact and access details'],
    ['delivery_contact', 'Delivery site contact and receiving hours'],
  ],
  express_delivery: [
    ['contents', 'Contents declaration'],
    ['recipient', 'Recipient name and contact details'],
  ],
  customs_clearance: [
    ['invoice', 'Commercial invoice'],
    ['packing_list', 'Packing list'],
    ['transport_doc', 'Transport document (bill of lading or air waybill)'],
    ['poa', 'Customs power of attorney for the broker'],
    ['certificates', 'Certificates of origin, permits or licences, if required'],
  ],
  project_cargo: [
    ['specs', 'Cargo drawings / specifications'],
    ['lifting', 'Lifting points and lifting plan'],
    ['site_access', 'Origin and destination site access details'],
    ['permits', 'Oversize permits or escorts, if required'],
  ],
};

/** Extra documents staff can pick from (on top of each service's standard list). */
const EXTRA_DOCUMENTS = {
  pet: [
    ['pet_passport', 'Pet passport (EU / UK)'],
    ['tapeworm', 'Tapeworm treatment record (UK, Ireland, Finland, Malta, Norway)'],
    ['parasite', 'Internal & external parasite treatment record'],
    ['fit_to_fly', 'Fit-to-fly letter from veterinarian'],
    ['crate_photos', 'Photos of pet standing in the travel crate (size check)'],
    ['cites', 'CITES permit (birds / protected species)'],
    ['owner_auth', 'Owner authorization letter (if someone else hands over the pet)'],
    ['breed_cert', 'Breed / pedigree certificate (for restricted-breed rules)'],
    ['medical_history', 'Full medical history'],
    ['pet_photo', 'Recent photo of the pet'],
  ],
  freight: [
    ['bill_of_lading', 'Bill of lading'],
    ['air_waybill_doc', 'Air waybill'],
    ['cert_origin', 'Certificate of origin'],
    ['insurance', 'Cargo insurance certificate'],
    ['ispm15', 'Wood packaging (ISPM-15) / fumigation certificate'],
    ['phyto', 'Phytosanitary certificate'],
    ['export_licence', 'Export licence'],
    ['sds', 'Safety data sheet (SDS)'],
    ['delivery_order', 'Delivery order'],
    ['pod', 'Signed proof of delivery'],
  ],
};

/**
 * Documents to choose from for a service, grouped: its standard list first, then extras
 * for the same category, then the other category. Each item is [key, label, isStandard].
 * Keys of extras are prefixed "lib_" so they never clash with standard keys.
 */
function documentOptions(serviceType) {
  const svc = SERVICE_TYPES[serviceType];
  const cat = svc ? svc.category : 'pet';
  const seen = new Set();
  const unique = (items) => items.filter(([, l]) => { const id = l.toLowerCase(); if (seen.has(id)) return false; seen.add(id); return true; });
  // Pets only ever see pet documents and items only item documents: the extras come from
  // the same category (its library + the other services' standard lists), never the other one.
  const sameCatStd = Object.entries(SERVICE_TYPES).filter(([k, s]) => s.category === cat && k !== serviceType)
    .flatMap(([k]) => (DOCUMENTS[k] || []).map(([dk, l]) => [`${k}__${dk}`, l, false]));
  return [
    { title: `Standard for ${svc ? svc.label : 'this service'}`, items: unique((DOCUMENTS[serviceType] || []).map(([k, l]) => [k, l, true])) },
    { title: cat === 'pet' ? 'Other pet travel documents' : 'Other item shipping documents',
      items: unique([...EXTRA_DOCUMENTS[cat].map(([k, l]) => [`lib_${k}`, l, false]), ...sameCatStd]) },
  ].filter((g) => g.items.length);
}

/** Resolve chosen keys to [key, label] for a service; unknown keys are ignored. */
function resolveDocuments(serviceType, keys) {
  const all = new Map(documentOptions(serviceType).flatMap((g) => g.items).map(([k, l]) => [k, l]));
  return [...new Set(keys.map(String))].filter((k) => all.has(k)).map((k) => [k, all.get(k)]);
}

function label(map, key) {
  const v = map[key];
  if (!v) return key;
  return typeof v === 'string' ? v : v.label;
}

/** "Biscuit (Dog)" for pets, the cargo description for freight. */
function itemName(x) {
  if (x.service_type && isFreight(x.service_type)) return x.cargo_description || 'Shipment';
  return x.pet_name || label(ITEM_LABELS, x.pet_type);
}

module.exports = {
  SERVICE_TYPES, SERVICE_BY_SLUG, PET_SERVICES, FREIGHT_SERVICES, isFreight, isAir,
  SHIPMENT_KINDS, kindOf, parseKind, PACKAGE_TYPES,
  PET_TYPES, CARGO, ITEM_LABELS, QUOTE_STATUSES, BOOKING_STATUSES, BOOKING_FLOW, DOCUMENTS, EXTRA_DOCUMENTS,
  documentOptions, resolveDocuments, label, itemName,
};
