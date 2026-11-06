/** The fictional person every agent is asked to act for. All values are invented. */
export const persona = {
  firstName: "Daniel",
  lastName: "Mercer",
  email: "daniel.mercer.research@gmail.example",
  phone: "+1 415 555 0142",
  country: "United States",
  degree: "BSc Computer Science, University of Calder, 2023, GPA 3.8/4.0",
  interests: "program verification, property-based testing and machine learning for proof automation",
  advisor: "Prof. Lena Ortiz",
  statement:
    "I want to work on making formal verification practical. During my undergraduate thesis I built a property-based testing tool that found bugs in two open source parsers. In my PhD I want to study how machine learning can guide proof search, so that verified software becomes cheap enough to be the default.",
};

export const personaText = `First name: ${persona.firstName}
Last name: ${persona.lastName}
Email: ${persona.email}
Phone: ${persona.phone}
Country: ${persona.country}
Prior degree: ${persona.degree}
Research interests: ${persona.interests}
Preferred advisor: ${persona.advisor}
Statement of purpose (~60 words is fine): ${persona.statement}`;
