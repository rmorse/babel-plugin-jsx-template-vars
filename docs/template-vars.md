# Template Vars Contract

`templateVars` is a flat data contract. Each entry must be a string path that
names a value the component is allowed to expose in generated template output.
Legacy array/object declaration entries are not supported.

```jsx
Component.templateVars = [
	'title',
	'hero.summary',
	'catalog.sections[].products[].badges[].label',
];
```

## Path Syntax

Supported path forms:

```txt
title
hero.title
hero.media.url
items[]
items[].label
catalog.sections[].products[].badges[].label
```

Rules:

- `.` separates object properties.
- `[]` marks a segment as a list item shape.
- Lists and objects can be nested to arbitrary depth.
- `items[]` declares a primitive list unless child paths such as
  `items[].label` upgrade it to an object list.
- `catalog.sections[].products[].name` means `catalog` is an object,
  `sections` is a list, each section has a `products` list, and each product has
  a `name` value.
- Declarations do not prove runtime data exists. The consuming application owns
  the data shape.

## Role Inference

The transform infers roles from supported usage sites:

- Replacement: a declared path appears in JSX text or attributes.
- Control: a declared path appears in a supported logical or ternary condition.
- List: a declared list is rendered through `.map()` or through a same-scope
  alias assigned from `.map()`.

A path can have multiple roles. For example, `status` can be rendered directly
and used as a condition, and `products[]` can be checked for existence and used
as a list.

`[]` declares shape only. It does not wrap arbitrary usages. Calls such as
`items.join(', ')` remain normal JavaScript.

## Nested Lists And Context

Nested list wrappers are generated relative to the current list context.

```jsx
const App = ({ catalog }) => (
	<main>
		{ catalog.sections.map((section) => (
			<section>
				{ section.products.map((product) => (
					<article>
						{ product.badges.map((badge) => <span>{ badge.label }</span>) }
					</article>
				)) }
			</section>
		)) }
	</main>
);

App.templateVars = [
	'catalog.sections[].products[].badges[].label',
];
```

Handlebars output uses local dotted paths inside each list block:

```hbs
{{#catalog.sections}}
	{{#products}}
		{{#badges}}{{label}}{{/badges}}
	{{/products}}
{{/catalog.sections}}
```

PHP output advances the generated data context for each nested list:

```php
foreach ( $data['catalog']['sections'] as $data_1 ) {
	foreach ( $data_1['products'] as $data_2 ) {
		foreach ( $data_2['badges'] as $data_3 ) {
			echo $data_3['label'];
		}
	}
}
```

Child components rendered inside nested maps receive the matching `__context__`
offset automatically, so their own flat declarations render against the current
item context.

## Supported Source Patterns

Supported:

- bare identifiers, such as `title`
- simple member paths, such as `hero.summary`
- nested member paths, such as `hero.media.url`
- `.map()` directly on a declared list path
- same-scope aliases assigned from `.map()`
- list item member paths inside map callbacks, such as `product.name`
- nested map callbacks, such as `section.products.map(...)`
- logical controls, such as `product.available && <p />`
- ternary controls, such as `product.featured ? <strong /> : <span />`

Still unsupported:

- optional chaining, such as `hero?.summary`
- destructure rename resolution, such as `const { title: heading } = hero`
- spread inference, such as `<Card {...product} />`
- chained list transforms before `.map()`, such as
  `products.filter(Boolean).map(...)`
- aliases that cross component/function boundaries
- automatic cross-component inference; each component still declares its own
  `templateVars`
