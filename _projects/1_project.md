---
layout: page
title: Endotracheal Tube Cuff Pressure Monitor
description: Development of a critical medical device to prevent ventilation-related complications
img: assets/img/medical_device.jpg
importance: 1
category: work
related_publications: true
---

# Endotracheal Tube Cuff Pressure Monitoring and Control System

## Project Overview

This TÜBİTAK-funded project (10M TRY grant) focused on developing a critical medical device to prevent ventilation-related illnesses in intensive care patients. The system monitors and controls endotracheal tube cuff pressure, ensuring optimal pressure levels to prevent complications while maintaining an effective seal.

## Clinical Significance

Maintaining proper endotracheal tube cuff pressure is critical in intubated patients:

- Too low pressure: Risk of aspiration pneumonia and ventilator-associated pneumonia
- Too high pressure: Risk of tracheal tissue damage and ischemia
- Our solution provides continuous monitoring and automatic adjustment to maintain optimal pressure range

## Technical Implementation

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/project_diagram.jpg" title="System architecture" class="img-fluid rounded z-depth-1" %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/gui_interface.jpg" title="User interface" class="img-fluid rounded z-depth-1" %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/mechanical_design.jpg" title="Mechanical components" class="img-fluid rounded z-depth-1" %}
    </div>
</div>
<div class="caption">
    Left: System architecture diagram. Middle: Graphical user interface for cuff pressure monitoring. Right: Mechanical manifold design for pressure control.
</div>

## My Contributions

As project lead and proposal writer, I was responsible for:

- Guiding the team in creating a solution for preventing ventilation-related illnesses
- Developing the control software using C programming language
- Designing an intuitive C++ GUI for medical professionals
- Creating a specialized manifold that enables seamless switching between vacuum and pressure on the pump
- Ensuring ISO 62304 compliance for medical device software

<div class="row">
    <div class="col-sm-8 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/testing_setup.jpg" title="Testing setup" class="img-fluid rounded z-depth-1" %}
    </div>
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/clinical_use.jpg" title="Clinical application" class="img-fluid rounded z-depth-1" %}
    </div>
</div>
<div class="caption">
    Left: Laboratory testing setup for pressure accuracy and response time. Right: Device in simulated clinical environment.
</div>

## Technical Challenges

The project presented several engineering challenges:

- Creating a responsive pressure control system with medical-grade accuracy
- Developing reliable pressure switching mechanisms
- Designing fault-detection algorithms to ensure patient safety
- Implementing an intuitive interface for busy healthcare environments
- Meeting strict medical device regulatory requirements (MDR and ISO 62304)

## Impact and Outcomes

This project has advanced patient care in intensive care units by:

- Reducing the risk of ventilator-associated complications
- Minimizing the need for manual monitoring by clinical staff
- Providing consistent pressure maintenance within safe parameters
- Contributing to improved outcomes for intubated patients
- Meeting critical regulatory requirements for medical device safety
