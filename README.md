# Babel JSX Template Vars
This is a Babel transform for rendering a template friendly version of your JSX app.  

It generates the markup + code to be used in a **pre-render build** for achieving SSR in environments which don't support JavaScript rendering.

Currently supports 2 output languages: 
* [Handlebars](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Handlebars)
* [PHP](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/PHP)

[Custom language definitions are also supported](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Custom-languages).

## What are template variables?

Template variables are variables in your components which you want to expose so that they can be used in another templating langauage.

They will usually be variables coming from an external data source, such as a database or an API.

The idea is that this transform will replace selected variables (across the components you specify) with the correct code or tag corresponding to your chosen language.

In Handlebars this might be: ```{{name}}``` and in PHP it might look like this: ```<?php echo $name ?>```.

Using this transform you will be able to use the same JSX code you've written, to output a Handlebars or PHP version of the same application.  

_Remember, it won't be interactive, this is only for generating an initial pre-render to achieve SSR._

> There are **a fair few limitations** so your mileage may vary.

## Workflow
1. Assumes you already have a React/Preact app with your development/production builds setup.
2. Create an additional build, a pre-render - which renders your app and extracts the rendered html (markup after running your app) into a file so it can be processed later on your server.
3. **Add this plugin to the pre-render build to add the template vars to the html output.**
4. Configure by adding `.templateVars` to components that have dynamic data.
5. Via your server side language, process the saved template file and pass in your data to get an SSR compatible pre-render.

## How to use

### 1. Install the package via npm

`npm install babel-plugin-jsx-template-vars`

### 2. Add to babel as a plugin to your pre-render build

#### E.g. With babel-loader + webpack
_This should only be added to your **pre-render** build._
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
[There are some additional initialisation options and things to watch out for](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Installation).

### 3. Define which variables in your components will be template variables.

Add a `templateVars` property to your component to specify which variables will be exposed.

The format is an array of flat data-path strings:

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

Object paths and nested list item paths can be declared in the same flat array:

```jsx
ProductCard.templateVars = [
    'title',
    'hero.summary',
    'catalog.sections[].products[].name',
    'catalog.sections[].products[].badges[].label',
];
```

See [docs/template-vars.md](docs/template-vars.md) for the full flat path
contract.


## Template variable roles

There are 3 usage roles that have different behaviours. Roles are inferred from
how the declared path is used in the component.

> **Note**
> **There are significant limitations with inferred control and list roles, [check the docs for more information](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Variable-types).**

### 1. Replacement variables

Replacement variables are declared paths that appear in rendered output.

In Handlebars this would be: `{{name}}`, and if using PHP this would be: `<?php echo $data['name'] ?>`.

Scalar paths and object paths are supported:

```js
Person.templateVars = [ 'name', 'profile.favoriteColor' ];
```


### 2. Control variables (showing/hiding content)
Depending on the value of a specific variable, you might wish to show or hide content in your component.

E.g.:
```jsx
const Person = ({ name, show, status }) => (
    <>
        <h1>{ name }</h1>
        { show && <p>Visible</p> }
        { status === 'ready' && <p>Ready</p> }
    </>
);

Person.templateVars = [ 'name', 'show', 'status' ];
```

In this example `show` and `status` are inferred as control variables because
they are used in supported conditional expressions. If a variable is also
rendered directly, it can be both a replacement and a control variable.


### 3. Lists (and repeatable elements)

It is important to have a mechanism for showing repeatable content like arrays or lists.

Primitive lists use `[]`:

```js
Person.templateVars = [ 'name', 'favoriteColors[]' ];
```

Object lists declare the item fields that should be exposed. Lists and objects
can be nested as deeply as the data contract needs:

```js
ProductList.templateVars = [
    'products[].name',
    'products[].url',
    'products[].available',
    'products[].badges[].label',
    'products[].details.manufacturer.name',
];
```

The `[]` marker declares list shape. List template wrappers are emitted when the
declared list is rendered directly as a primitive root list or used with a
supported `.map()` expression. Other member calls, such as `products.join(', ')`,
are left as normal JavaScript.


***

**[More information on template variable roles can be found in the Wiki](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Variable-types).**

## Exposing variables

The above example uses variables derived from destructured `props` passed into a component. 

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

Simple object properties can be declared as paths:

```jsx
const Person = ({ profile }) => {
    return (
        <>
            <h1>{ profile.name }</h1>
            <p>Favorite color: { profile.favoriteColor }</p>
        </>
    );
};
Person.templateVars = [ 'profile.name', 'profile.favoriteColor' ];
```

Supported source patterns include bare identifiers, simple object member paths,
nested object member paths, direct `.map()` usage on declared list paths, nested
map callbacks, and same-scope aliases assigned from `.map()`. Destructure
renames, optional chaining, spreads, chained list transforms before `.map()`,
and aliases that cross component/function boundaries are not supported yet.

## Working examples

[There is a working example using PHP output provided here.](https://github.com/rmorse/ssr-preact-php)

[There is a working example using Handlebars output provided here](https://github.com/rmorse/ssr-preact-php-handlebars) (also, using PHP).

**Please [open an issue](https://github.com/rmorse/babel-plugin-jsx-template-vars/issues/new) if you have a demo project in other languages and we'll add it here.**

## Output languages

Currently supports outputting to:

 * [Handlebars](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Handlebars)
 * [PHP](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/PHP)
 * [Custom languages](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Custom-languages)

More information on languages can be found in the [wiki](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Output-languages).

## Documentation

I think I mentioned that there are **significant limitations** with the different inferred roles - its important to understand how these work in order to use this transform effectively.

[More information is being added to the docs, currently on our github Wiki](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki).

## Caveats

### This is currently experimental
This is an exploration on a concept of semi automating the generation of Handlebars templates from JSX apps - its a first pass with a lot of holes and things to do as such its marked as alpha.

_I'd be grateful for any help with the project / suggestions and alternative ideas for exploration / bug reports_.

### Data fetching & loading with replacement variables
One thing to watch out for is data fetching and loading.

In complex applications, vars/props will often get passed down into various data fetching routines, and if they are replaced with template tags too early, such as `{{name}}` it might cause them to fail.  They need to succeed and continue as usual to get a true pre-render.

To work around this you can try to set your template vars only on components that live underneath the data requests (futher down the tree).  This will ensure that the data is loaded before the template vars are replaced.

In some cases, you might need the template variable passed into the data fetching routine - this is not supported and a limitation of this approach.

### Nested props in list variables
This transform supports flat paths for nested objects and lists, including
mixed object/list paths such as `catalog.sections[].products[].badges[].label`.

Each component still owns its own `templateVars` contract; nested declarations
are not inferred automatically across component boundaries.

