'use strict';
/**
 * Copy for the pet service pages (rendered by views/site/pet-service.ejs).
 * Edit freely: titles, paragraphs, features, steps and FAQs.
 */
module.exports = {
  'pet-transport': {
    service: null,
    title: 'Pet Transport',
    description: 'Safe, caring pet transport by road and air: route planning, paperwork guidance, crate preparation and updates from pickup to reunion.',
    image: '/images/post-22.jpeg', imageAlt: 'Dogs, cats, birds and other pets ready for a safe journey',
    kicker: 'Support throughout the journey',
    heading: 'Thoughtful planning for your pet\'s journey',
    paragraphs: [
      'Pet travel takes preparation, the right transport and attention to your pet\'s individual needs. Lancaster Pet Movers coordinates domestic and international journeys from pickup to arrival.',
      'Before travel we review the route, dates, your pet\'s details, crate needs, paperwork and destination rules. We keep you informed at every stage, while veterinarians, airlines and authorities handle their own approvals.',
    ],
    features: [
      ['fa-route', 'Route and schedule planning', 'Travel stages planned around your pet, your route, your schedule and destination requirements.'],
      ['fa-notes-medical', 'Travel paperwork support', 'A personal checklist of the documents to confirm with your veterinarian and the relevant authorities.'],
      ['fa-box-open', 'Travel crate preparation', 'Help choosing and preparing a secure crate of the right size for your pet and the journey.'],
      ['fa-comment-dots', 'Updates you can rely on', 'Email updates at key stages, plus a tracking page you can check any time.'],
    ],
    stepsTitle: 'Planning your pet\'s move',
    steps: [
      ['Review', 'We gather your pet\'s details, route, timing and health considerations.'],
      ['Prepare', 'We guide you through paperwork, crate needs and travel requirements.'],
      ['Travel', 'We coordinate pickup, the journey itself and any transfers.'],
      ['Reunite', 'We arrange the final hand-over so you and your pet are together again.'],
    ],
    faqs: [
      ['What details do you need to plan pet travel?', 'Tell us the species, breed, age, size and weight, any health considerations, the origin and destination, your preferred date, and whether the journey is domestic or international.'],
      ['What health paperwork might my pet need?', 'Depending on the route, your pet may need a veterinary examination, vaccination records, a health certificate, a microchip, permits or other official documents. We give you a personal checklist, and final requirements are confirmed with your veterinarian and the destination authorities.'],
      ['How can I prepare my pet for the journey?', 'Get your pet used to the travel crate early, arrange vet checks in good time, update identification tags and plan feeding around the travel schedule. Always discuss medication or sedation with your veterinarian.'],
    ],
    help: ['Getting ready to move your pet?', 'Share your pet\'s details, route, preferred date and any health or handling needs.'],
    cta: ['Start planning your pet\'s journey', 'Get in touch early to allow time for route planning, paperwork and travel preparation.'],
  },

  'pet-ground-transport': {
    service: 'domestic_ground',
    title: 'Pet Ground Transport',
    description: 'Door-to-door pet transport by climate-controlled vehicle, with comfort stops and updates from your driver.',
    image: '/images/truck-road.jpg', imageAlt: 'Pet transport vehicle on the open road',
    kicker: 'Door to door, by road',
    heading: 'Comfortable road travel for your pet',
    paragraphs: [
      'Our ground transport carries pets door to door in climate-controlled vehicles. Your pet travels with an experienced handler, never as cargo, with regular comfort breaks along the way.',
      'Road travel is often the kindest option for snub-nosed breeds, anxious pets, senior animals and families moving several pets together.',
    ],
    features: [
      ['fa-house-chimney', 'Door-to-door service', 'We collect from your home and deliver to the new address, so your pet never waits at a terminal.'],
      ['fa-temperature-half', 'Climate-controlled vehicles', 'Comfortable temperatures and secure, well-ventilated travel spaces.'],
      ['fa-person-walking', 'Regular comfort stops', 'Walks, water and rest breaks planned along the route.'],
      ['fa-camera', 'Updates from your driver', 'Photo and progress updates so you can follow the trip.'],
    ],
    stepsTitle: 'How ground transport works',
    steps: [
      ['Tell us', 'Share your route, dates and your pet\'s needs.'],
      ['Plan', 'We confirm the route, the type of trip and a pickup window.'],
      ['Collect', 'Your driver collects your pet with food, medication and comfort items.'],
      ['Deliver', 'We hand your pet over at the destination and confirm arrival.'],
    ],
    faqs: [
      ['Can my pet travel with others?', 'Yes. We offer shared trips, which are cost-effective, and private trips for pets who need extra space or a direct route.'],
      ['What should I pack for my pet?', 'Their usual food, any medication with written instructions, a familiar blanket or toy, and a copy of their vaccination records.'],
      ['How often do you stop?', 'Stops are planned around your pet\'s needs, usually every few hours for walks, water and rest.'],
    ],
    help: ['Moving by road?', 'Tell us your route and dates and we\'ll check driver availability.'],
    cta: ['Plan a road trip for your pet', 'Free quote, usually within one business day.'],
  },

  'pet-air-travel': {
    service: 'domestic_air',
    title: 'Domestic Pet Flights',
    description: 'Airline-booked pet travel between U.S. airports, with crate sizing, health certificate timing, and airport drop-off and pickup.',
    image: '/images/plane-clouds.jpg', imageAlt: 'Passenger plane flying above the clouds',
    kicker: 'Fast and carefully planned',
    heading: 'Domestic flights, planned around your pet',
    paragraphs: [
      'For longer moves within the U.S., flying is often the fastest and least tiring option. We book with airlines that run dedicated pet programs and handle the details that make the day go smoothly.',
      'We size the travel crate, time the health certificate, and arrange drop-off at the departure airport and pickup on arrival.',
    ],
    features: [
      ['fa-plane-departure', 'Airline booking', 'Space booked with airlines that have dedicated pet programs.'],
      ['fa-box-open', 'IATA crate sizing', 'An airline-compliant crate of the right size, so your pet is accepted at check-in.'],
      ['fa-file-medical', 'Health certificate timing', 'Guidance so your vet visit falls inside the airline\'s time window.'],
      ['fa-location-crosshairs', 'Track the flight', 'An air waybill number you can check on the airline\'s own website.'],
    ],
    stepsTitle: 'How domestic pet flights work',
    steps: [
      ['Tell us', 'Breed, weight and route help us choose the right airline.'],
      ['Quote', 'A written quote including crate, transfers and airline fees.'],
      ['Prepare', 'We guide you through the health certificate and crate training.'],
      ['Fly', 'Your pet flies and is collected on arrival for the final hand-over.'],
    ],
    faqs: [
      ['Can every breed fly?', 'Some airlines restrict snub-nosed (brachycephalic) breeds and travel in hot weather. If flying isn\'t right for your pet, we\'ll recommend ground transport instead.'],
      ['How do I follow the flight?', 'Once the flight is booked you receive the air waybill number. Enter it on the airline\'s cargo site for live status, or check your booking on our Track page.'],
      ['When should my pet see the vet?', 'Most airlines need a health certificate issued within about 10 days of travel. We\'ll confirm the exact window for your flight.'],
    ],
    help: ['Flying your pet?', 'Share your pet\'s breed, weight and route and we\'ll find the right airline.'],
    cta: ['Book your pet\'s flight', 'Free quote, usually within one business day.'],
  },

  'international-pet-relocation': {
    service: 'international_air',
    title: 'International Pet Relocation',
    description: 'Moving abroad with your pet: destination-specific document timelines, USDA endorsement coordination, airline booking and arrival support.',
    image: '/images/hero-port-sunset.jpg', imageAlt: 'Plane flying at sunset on an international journey',
    kicker: 'Moving abroad together',
    heading: 'International moves, step by step',
    paragraphs: [
      'Moving abroad with a pet means strict rules: microchips, rabies vaccination timing, titer tests, import permits and government endorsements. Every country is different.',
      'We build a timeline for your destination and coordinate each step, so your pet arrives with the right paperwork and is cleared smoothly on arrival.',
    ],
    features: [
      ['fa-calendar-check', 'Destination timeline', 'A step-by-step plan with dates for every vet visit and document.'],
      ['fa-syringe', 'Vaccines and tests', 'Guidance on microchip, rabies, titer and parasite treatment timing.'],
      ['fa-stamp', 'Government endorsement', 'Coordination of the USDA APHIS endorsement of your pet\'s health certificate.'],
      ['fa-earth-americas', 'Arrival coordination', 'Help with arrival inspection and hand-over in the destination country.'],
    ],
    stepsTitle: 'How international relocation works',
    steps: [
      ['Destination', 'Rules vary by country, so we start with where you\'re going.'],
      ['Timeline', 'We map out each vet step with dates you can plan around.'],
      ['Documents', 'We review every document before the government endorsement.'],
      ['Arrival', 'Your pet flies and we coordinate the arrival and hand-over.'],
    ],
    faqs: [
      ['How early should I start?', 'As early as possible. Some countries need a titer test and waiting period that take three months or more, so start planning as soon as you know your move date.'],
      ['Does my pet need quarantine?', 'It depends on the destination and on your pet meeting the entry rules. Many countries avoid quarantine when the paperwork is complete and correctly timed.'],
      ['Which documents are needed?', 'Usually an ISO microchip, rabies vaccination, an international health certificate with USDA endorsement, and sometimes a titer test or import permit. You get a personal checklist after booking.'],
    ],
    help: ['Moving abroad?', 'Tell us the destination country and your move date to get a timeline.'],
    cta: ['Plan your pet\'s international move', 'Get a timeline and quote, usually within two business days.'],
  },
};
