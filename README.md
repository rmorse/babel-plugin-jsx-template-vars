# Babel JSX Template Vars
A Babel transform for rendering a template friendly version of your JSX app.  

Generates a Handlebars based pre-render for achieving SSR in environments which don't support JavaScript rendering (e.g. PHP).

## What are template variables?
The idea is that this transform will replace selected variables (across the components you specify) with Handlebars tags such as `{{name}}`. 

Replacing variables with template tags allows you to render your application via the [Handlebars](https://handlebarsjs.com/) templating engine, which is supported in a lot of different languages.

There are **a fair few limitations** so your mileage may vary.

## How it works

Add this transform plugin to babel in your pre-render build to replace your component variables with template tags such as `{{name}}`- allowing the resulting markup to be processed as a Handlebars compatible template.

### Workflow
1. Assumes you already have a React/Preact app with your development/production builds setup.
2. Create an additional build, a **pre-render** - which renders your app and extracts the rendered html (markup after running your app) into a file so it can be processed later on your server.
3. **Add this plugin to the pre-render build** to add the Handlebars tags to the html output.
4. Configure by adding `.templateVars` to components that have dynamic data.
5. Via your server side language (eg PHP), process the saved template file and pass in your data to get an SSR compatible pre-render.

### An example

Lets take a component: 

```js
const HelloWorld = ({ name }) => (
  <div>
    <h1>Hello {name}</h1>
  </div>
);
```
Once we run our app, this might generate html like:
```html
<div>
  <h1>Hello Mary</h1>
</div>
```
In order to render this on the server using Handlebars, we need to replace the name `Mary` with a template tag, so the output would be

```html
<div>
    <h1>Hello {{name}}</h1>
</div>
```

Using this plugin, adding a `.templateVars` property on your component will render it using the Handlebars template tag above.

```js
const HelloWorld = ({ name }) => (
  <div>
    <h1>Hello { name }</h1>
  </div>
);
HelloWorld.templateVars = [ 'name' ];
```
There are other types variables (not only strings to be replaced) such as control and list variables.

## How to use

### 1. Install the package via npm

`npm install babel-plugin-jsx-template-vars`

### 2. Add to babel as a plugin

#### Via .babelrc
```js
{
  "plugins": [
    "babel-plugin-jsx-template-vars"
  ]
}
```
#### With babel-loader + webpack
```js
{
    test: /\.(js|jsx|tsx|ts)$/,
    exclude: /node_modules/,
    loader: "babel-loader",
    options: {
        plugins: [
            'babel-plugin-jsx-template-vars'
        ],
        presets: []
    }
},
```

**Note:** You will still need to add this transform to your existing builds (with the option `tidyOnly: true`) so that the `.templateVars` properties are removed from your production/development code, e.g.

```js
plugins: [
    [ 'babel-plugin-jsx-template-vars', { tidyOnly: true } ]
],
```

### 3. Define which variables in the component will be template variables.

Add a `templateVars` property to your component to specificy which should be replaced template tags. 

Format is an array, of strings (or arrays with additional config):

```jsx
const Person = ( { name, favoriteColor } ) => {
    return (
        <>
            <h1>{ name }</h1>
            <p>Favorite color: { favoriteColor }</p>
        </>
    );
};
Person.templateVars = [ 'name', 'favoriteColor' ];
```


## Template variable types

There are 3 types of variables that have different behaviours:

### 1. Replacement variables

Replacement variables are variables that will be replaced with a template tag, e.g. `{{name}}`, usually to display a dynamic string value.

All examples above show replacement variables, and they are the default type for a variable if a type is not set.

### 2. Control variables (showing/hiding content)
Depending on the value of a specific variable, you might wish to show or hide content in your component.  Use the `control` type variable to signify this.

In the below example `show` is used as a control type variable.

```jsx
const Person = ( { name, favoriteColor, show } ) => {
    return (
        <>
            <h1>{ name }</h1>
            <p>Favorite color: { favoriteColor }</p>
            { show && <p>Show this content</p> }
        </>
    );
};
Person.templateVars = [ 'name', 'favoriteColor', [ 'show', { type: 'control' } ] ];
```
By signifying the variable as a control variable, the correct handlebars tags (and expression) is added to the output.

The result would be:

```html
<h1>{{name}}</h1>
<p>Favorite color: {{favoriteColor}}</p>
{{#if_truthy show}}
    <p>Show this content</p>
{{/if_truthy}}
```

**Note:** the control variable and condition to evaluate is parsed from the source code automatically but has some limitations.
#### Current limitations of control variables
 - Only detects conditions in a JSX expression container (e.g., in a components return function, or between opening and closing JSX tags `<>...</>`) 
 - JSX expressions must use `&&` to evaluate the condition and [show the JSX content as shown in the React JS docs](https://reactjs.org/docs/conditional-rendering.html).
 - Supports 4 types of expressions:
    1. `truthy` - if the value is truthy, show the content.
        ```jsx
        { isActive && <>...</> }
        ```
    2. `falsy` - if the value is falsy, show the content.
        ```jsx
        { ! isActive && <>...</> }
        ```
    3. `equals` - if the value is equal to the specified value, show the content.
        ```jsx
        { isActive === 'yes' && <>...</> }
        ```
    4. `not equals` - if the value is not equal to the specified value, show the content.
        ```jsx
        { isActive !== 'yes' && <>...</> }
        ```
 - The subject (or template var) must on the left of the expression - e.g., `{ isActive === 'yes' && <>...</> }`... not `{ 'yes' === isActive && <>...</> }`.

Support for more expression types is planned.

#### Handlebars helpers
Handlebars doesn't come with out of the box support for conditions such as `equals` and `not equals`.

`if_truthy`, `if_falsy`, `if_equal`, and `if_not_equal` should be added as custom helpers to your handlebars implementation.

[An implemenation of these helpers using the Handlebars PHP package is provided here](https://gist.github.com/rmorse/3653f811407ef3a3ec649c8de315085f).


### 3. Lists (and repeatable elements)

To use repeatable elements and lists in Handlebars templates, our code must be contain special tags, before and after the list, with the single repeatable item in between.

```html
    <section class="profile">
        {{#favoriteColors}}
            <p>A favorite color: {{label}}</p>
        {{/favoriteColors}}
    </section>
```

First we need to define which var is array like (`favoriteColors`) and then the object properties of the child to be iterated (or no properties if the child is a JavaScript primitive).

```jsx
const Person = ( { name, favoriteColors } ) => {
    const favoriteColorsList = favoriteColors.map( ( color, index ) => {
        return (
            <p key={ index }>A favorite color: { color.label }</p>
        );
    } );
    return (
        <>
            <h1>{ name }</h1>
            { favoriteColorsList }
        </>
    );
};
// Setup favoriteColors as type list with objects as children.
Person.templateVars = [ 'name', [ 'favoriteColors', { type: 'list', child: { type: 'object', props: [ 'value', 'label' ] } } ] ];
```

This will generate an array with a single value (and Handlebars tags), with an object as described by the `child` props, resulting in the following output:

```html
    <section class="profile">
        {{#favoriteColors}}
            <p>A favorite color: {{label}}</p>
        {{/favoriteColors}}
    </section>
```

Array mapping is also supported in JSX expressions.

```jsx
const Person = ( { name, favoriteColors } ) => {
    return (
        <>
            <h1>{ name }</h1>
            { favoriteColors.map( ( color, index ) => {
                return (
                    <p key={ index }>A favorite color: { color.label }</p>
                );
            } ) }
        </>
    );
};

## Exposing variables

The above examples have all used variables derived from `props` passed into a component. 

Any variable (identifier) that resides directly in the components scope can be used:

```jsx
const Person = () => {
    const [ name, setName ] = useState( '' );
    let favoriteColor = 'green';

    return (
        <>
            <h1>{ name }</h1>
            <p>Favorite color: { favoriteColor }</p>
        </>
    );
};
Person.templateVars = [ 'name', 'favoriteColor' ];
```
Object properties (e.g. `aPerson.favoriteColor`) are not yet supported but it should be possible to add support for this in the future.  In these cases you can destructure the object and use the object properties as template variables:

```jsx
const aPerson = {
    name: 'Mary',
    favoriteColor: 'green'
};
const Person = () => {
    const { name, favoriteColor } = aPerson;
    return (
        <>
            <h1>{ name }</h1>
            <p>Favorite color: { favoriteColor }</p>
        </>
    );
};
Person.templateVars = [ 'name', 'favoriteColor' ];
```

## Working example

[There is a working example using PHP provided here.](https://github.com/rmorse/ssr-preact-php)

## Caveats

### This is currently experimental
This is an exploration on a concept of semi automating the generation of Handlebars templates from JSX apps - its a first pass with a lot of holes and things to do as such its marked as alpha.

_I'd be grateful for any help with the project / suggestions and alternative ideas for exploration / bug reports_.

### Data fetching & loading with `replace` type variables
One thing to watch out for is data fetching and loading.

In complex applications, vars/props will often get passed down into various data fetching routines, and if they are replaced with template tags too early, such as `{{name}}` it might cause them to fail.  They need to succeed and continue as usual to get a true pre-render.

To work around this you can try to set your template vars only on components that live underneath the data requests (futher down the tree).  This will ensure that the data is loaded before the template vars are replaced.

In some cases, you might need the template variable passed into the data fetching routine - this is not supported and a limitation of this approach.

### Nested props in `list` type variables
This transform supports nested vars for children (arrays and objects), but only supports 1 level of depth.

It is recommended to set template vars on components that reside further down the tree and deal with those nested props directly.


## An example showing all possible usage options
**TODO: move to proper documentation**

```jsx
const Person = ( { name, dob, favoriteColors, favoriteArtists, traits, showColors = true, showArtists = true, ...props } ) => {
	const showTest = 'yes';
	const favoriteColorsList = favoriteColors.map( ( color, index ) => {
		return (
			<div key={ index }>
				{ color.label }
			</div>
		);
	} );
	return (
		<section class="profile">
			<h1>{ name }</h1>
			<p>Date of birth: { dob }</p>
			{ /* showColors && favoriteColorsList */ }
			{ showColors && (
				<>
					<h2>Favorite Colors</h2>
					<div>{ favoriteColorsList }</div>
				</>
			) }
			{ showArtists && (
				<>
					<h2>Favorite Artists</h2>
					<div>
						{ favoriteArtists.map( ( artist, index ) => {
							return (
								<div key={ index }>
									{ artist.name } | { artist.genre }
								</div>
							)
						} ) }
					</div>
				</>
			) }
			<h2>Character traits</h2>
			{ traits.map( ( trait, index ) => {
				return (
					<div>A trait: { trait }</div>
				);
			} ) }
			<h2>Character traits raw</h2>
			{ traits }
			<h2>Combining control + replace variables</h2> 
			{ showTest === 'yes' && name }
			<h2>Combining control + list variables</h2> 
			{ showTest === 'yes' && traits }
		</section>
	);
}
Person.templateVars = [
	'name',
	'dob',
	[ 'showColors', { type: 'control' } ],
	[ 'showArtists', { type: 'control' } ],
	[ 'favoriteColors', { type: 'list', child: { type: 'object', props: [ 'value', 'label' ] } } ],
	[ 'favoriteArtists', { type: 'list', child: { type: 'object', props: [ 'name', 'genre' ] } } ],
	[ 'traits', { type: 'list' } ],
	[ 'showTest', { type: 'control' } ],
];
```
### This will output handlebars code
```handlebars
<section class="profile">
    <h1>{{name}}</h1>
    <p>Date of birth: {{dob}}</p>
    {{#if_truthy showColors}}
        <h2>Favorite Colors</h2>
        <div>
            {{#favoriteColors}}
                <div>{{label}}</div>
            {{/favoriteColors}}
        </div>
    {{/if_truthy}}
    {{#if_truthy showArtists}}
        <h2>Favorite Artists</h2>
        <div>
            {{#favoriteArtists}}
                <div>{{name}} | {{genre}}</div>
            {{/favoriteArtists}}
        </div>
    {{/if_truthy}}
    <h2>Character traits</h2>
    {{#traits}}
        <div>A trait: {{.}}</div>
    {{/traits}}
    <h2>Character traits raw</h2>
    {{#traits}}
        {{.}}
    {{/traits}}
    <h2>Combining control + replace variables</h2>
    {{#if_equal showTest "yes"}}
        {{name}}
    {{/if_equal}}
    <h2>Combining control + list variables</h2>
    {{#if_equal showTest "yes"}}
        {{#traits}}
            {{.}}
        {{/traits}}
    {{/if_equal}}
</section>
```