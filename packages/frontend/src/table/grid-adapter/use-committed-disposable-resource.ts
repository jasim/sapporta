import { useEffect, useState, type DependencyList } from "react";

type DisposableResource = {
  dispose(): void;
};

type CommittedDisposableResourceEntry<TResource> = {
  deps: DependencyList;
  resource: TResource;
};

// Own a disposable resource whose construction must happen after commit.
// Render gets null until the stored resource belongs to the current deps.
export function useCommittedDisposableResource<
  TResource extends DisposableResource,
>(create: () => TResource, deps: DependencyList): TResource | null {
  const [entry, setEntry] =
    useState<CommittedDisposableResourceEntry<TResource> | null>(null);

  useEffect(() => {
    const resource = create();
    setEntry({ deps: [...deps], resource });
    return () => {
      resource.dispose();
    };
  }, deps);

  if (!entry || !dependencyListsMatch(entry.deps, deps)) {
    return null;
  }

  return entry.resource;
}

function dependencyListsMatch(
  left: DependencyList,
  right: DependencyList,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}
