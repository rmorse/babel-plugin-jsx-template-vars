# Babel JSX Template Vars
A Babel transform for rendering a template friendly version of your JSX app.  

Generates a pre-render for achieving SSR in environments which don't support JavaScript rendering.

Currently supports 2 output languages: Handlebars and PHP.

Custom language definitions are also supported.

## What are template variables?

Template variables are variables in your components which you want to expose so that they can be used in another templating langauage.

They will usually be variables coming from an external data source, such as a database or API.

The idea is that this transform will replace selected variables (across the components you specify) with the correct code or tag corresponding to your chosen language.

In Handlebars this might be: ```{{name}}``` and in PHP it might look like this: ```<?php echo $name ?>```.

Using this transform you will be able to use the same JSX code you've written, to output a Handlebars or PHP version of the same application.  

Remember, it won't be interactive, this is only for generating an initial pre-render to achieve SSR.

There are **a fair few limitations** so your mileage may vary.

## How it works

### Workflow
1. Assumes you already have a React/Preact app with your development/production builds setup.
2. Create an additional build, a **pre-render** - which renders your app and extracts the rendered html (markup after running your app) into a file so it can be processed later on your server.
3. **Add this plugin to the pre-render build** to add the template vars to the html output.
4. Configure by adding `.templateVars` to components that have dynamic data.
5. Via your server side language, process the saved template file and pass in your data to get an SSR compatible pre-render.

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

Using this plugin, adding a `.templateVars` property on your component will expose the variable to you chosen output language.

```js
const HelloWorld = ({ name }) => (
  <div>
    <h1>Hello { name }</h1>
  </div>
);
HelloWorld.templateVars = [ 'name' ];
```

If using Handlebars, the output would be:
```handlebars
<div>
    <h1>Hello {{name}}</h1>
</div>
```

If using PHP, the output would be:

```php
<div>
    <h1>Hello <?php echo $name ?></h1>
</div>
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

### 3. Define which variables in your components will be template variables.

Add a `templateVars` property to your component to specificy which variable will be exposed.

The format is an array, of strings (or arrays with additional config):

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

If using Handlebars the result would be:

```handlebars
<h1>{{name}}</h1>
<p>Favorite color: {{favoriteColor}}</p>
{{#if_truthy show}}
    <p>Show this content</p>
{{/if_truthy}}
```

If using PHP, the output would be:
```php
<h1><?php echo $name; ?></h1>
<p>Favorite color: <?php echo $favoriteColor; ?></p>
<?php if ($show) { ?>
    <p>Show this content</p>
<?php } ?>
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
 - The subject (or template var) must on the left of the expression - e.g., `{ isActive === 'yes' && <>...</> }`
   Do not do this: `{ 'yes' === isActive && <>...</> }`.

Support for more expression types is planned.

### 3. Lists (and repeatable elements)

To use repeatable elements and lists we have to use Handlebars tags, or a PHP `foreach` loop to iterate over the list items.

Generated handlebars code would look like this:
```handlebars
    <section class="profile">
        {{#favoriteColors}}
            <p>A favorite color: {{label}}</p>
        {{/favoriteColors}}
    </section>
```
Generated PHP code would look like this:
```php
    <section class="profile">
        <?php foreach ($data['favoriteColors'] as $item) { ?>
            <p>A favorite color: <?php echo $item['label']; ?></p>
        <?php } ?>
    </section>
```

To achieve this, first we need to define which variable is array like (`favoriteColors`) and then the object properties of the child to be iterated (or no properties if the child is a JavaScript primitive).

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

Array mapping is also supported in JSX expressions:
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
```

## Exposing variables

The above examples have all used variables derived from desctructured `props` passed into a component. 

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

[There is a working example using PHP output provided here.](https://github.com/rmorse/ssr-preact-php)
[There is a working example using Handlebars output provided here](https://github.com/rmorse/ssr-preact-php-handlebars) (also, using PHP).

**Open an issue if you have a demo project in other languages and we'll add it here.**

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

