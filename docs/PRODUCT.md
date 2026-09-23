# PlaceEcho Product v0.1

## Core Insight

> **长期生活的空间里，积累着许多通向个人回忆的线索。**

A lived-in space contains cues that can lead back to personal memories.

> **A Memory does not need to have happened in the current Scene.**

A poster may recall cinema visits elsewhere; a souvenir may recall another city; a window may recall sunsets from many dates. The spatial cue is an entry point to a Memory, not necessarily the event location.

## Problem

Personal media is often detached from the lived-in spaces and ordinary objects that make it meaningful. Generic automated organization cannot decide which memories a person should care about.

## Product

PlaceEcho is an AI-driven personal spatial-memory experience. A user preserves one lived-in space, actively selects personal media, and revisits Memories through cues anchored back into that space.

## Design Principle

The user decides what is meaningful by selecting the media. AI assists with understanding, grouping, cue identification, visual grounding, and reconnection to the space; it does not decide personal importance.

Scene Context is an optional description of the whole preserved space. A Memory Reflection is an optional later statement about one specific Memory. They are separate fields and must not be automatically duplicated.

Authoring copy should ask the user which personal media they want to preserve with the space. It must not require the user to decide whether an asset was captured in the Scene or recalled through a spatial cue; that distinction is a product principle, not an authoring task.

## Main User Flow

```text
Capture Space
  -> Select 6–12 Personal Media
  -> Optional Scene Context
  -> AI Memory Understanding
  -> 2–3 Memory Groups + Cues + Source Panorama Grounding
  -> Generate or Load Gaussian World + Collider
  -> Final World Grounding
  -> Collider Raycast
  -> 3D Memory Anchors
  -> Optional Hero Objects
  -> Wind Mode / Revisit
  -> Memory Reveal
```

## Hackathon MVP

- one lived-in space;
- two or three Memory groups;
- 6–12 user-selected media assets;
- two or three Memory Anchors;
- at least one complete AI → Grounding → Raycast → Reveal pipeline;
- a 60–90 second Revisit experience.

The demo must support an existing pre-generated Gaussian + Collider world and must not depend on a live Marble job succeeding during presentation.

## Non-goals

- scanning the entire photo library;
- automatically deciding personal importance;
- requiring a Memory to have happened at its Anchor location;
- millimeter-accurate digital-twin reconstruction;
- a generic AI-agent framework;
- complex audio/video editing;
- mandatory Hero Objects;
- account, social, or production database systems;
- implementing product behavior during repository initialization.
