'use strict';
/**
 * Reads and validates the shipment part of a form (public quote, admin quote, admin booking).
 * Pet and item shipments have different fields; this keeps the two strictly separate.
 */
const v = require('./validate');
const { SERVICE_TYPES, PET_TYPES, PACKAGE_TYPES, CARGO, kindOf, parseKind } = require('./domain');

/** Which kind of shipment a form is for: explicit `kind` field, else the chosen service's category. */
function kindFrom(body, query = {}) {
  return parseKind(body.kind) || parseKind(query.type) || kindOf(body.service_type) || kindOf(query.service) || null;
}

/**
 * Returns { kind, values, errors }. `values` is ready for services.createQuote/createBooking.
 */
function readShipment(body, kind) {
  const errors = {};
  const service = v.oneOf(body.service_type, SERVICE_TYPES);
  const values = {
    kind,
    service_type: service && kindOf(service) === kind ? service : null,
    origin: v.str(body.origin, 160),
    destination: v.str(body.destination, 160),
    travel_date: v.date(body.travel_date),
    weight_lbs: v.num(body.weight_lbs, { min: 0, max: 200000 }),
    pet_count: v.int(body.pet_count, { min: 1, max: 9999 }) || 1,
    special_needs: v.str(body.special_needs, 1000),
    // pet-only
    pet_type: null, pet_name: '', breed: '', pet_age: '',
    // item-only
    cargo_description: '', package_type: null, dimensions: '', declared_value: null,
  };

  if (kind === 'pet') {
    values.pet_type = v.oneOf(body.pet_type, PET_TYPES);
    values.pet_name = v.str(body.pet_name, 80);
    values.breed = v.str(body.breed, 80);
    values.pet_age = v.str(body.pet_age, 40);
    if (!values.pet_type) errors.pet_type = 'Please choose the type of pet.';
  } else if (kind === 'freight') {
    values.pet_type = CARGO;
    values.cargo_description = v.str(body.cargo_description, 300);
    values.package_type = v.oneOf(body.package_type, PACKAGE_TYPES);
    values.dimensions = v.str(body.dimensions, 120);
    values.declared_value = v.num(body.declared_value, { min: 0, max: 100000000 });
    if (!values.cargo_description) errors.cargo_description = 'Please describe what is being shipped.';
  } else {
    errors.kind = 'Please choose a pet or an item shipment.';
  }

  if (!values.service_type) errors.service_type = 'Please choose a service.';
  if (!values.origin) errors.origin = 'Where is it travelling from?';
  if (!values.destination) errors.destination = 'Where is it travelling to?';
  if (body.travel_date && !values.travel_date) errors.travel_date = 'Please enter a valid date.';
  return { kind, values, errors };
}

module.exports = { kindFrom, readShipment };
