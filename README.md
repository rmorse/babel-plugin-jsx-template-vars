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

Add a `templateVars` property to your component to specificy which variables will be exposed.

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

There are 3 types of variables that have different behaviours.

> **Note**
> **There are significant limitations with `control` and `list` type variables, [check the docs for more information](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Variable-types).**

### 1. Replacement variables

Replacement variables are variables that will need to be replaced by a dynamic variable.

In Handlebars this would be: `{{name}}`, and if using PHP this would be: `<?php echo $data['name'] ?>`.

The default variable type is a replacement variable:

```js
Person.templateVars = [ 'name' ];
```

The type can also be passed as an argument:

```js
Person.templateVars = [ [ 'name', { type: 'replace' } ] ];
```


### 2. Control variables (showing/hiding content)
Depending on the value of a specific variable, you might wish to show or hide content in your component.  Use the `control` type variable to signify this.

E.g.:
```js
Person.templateVars = [ 'name', [ 'show', { type: 'control' } ] ];
```

In this example `show` is used a control variable.


### 3. Lists (and repeatable elements)

It is important to have a mechanism for showing repeatable content like arrays or lists. 

This is supported with some limitations, and is signified by the `list` variable type:

```js
Person.templateVars = [ 'name', [ 'favoriteColors', { type: 'list' } ] ];
```


***

**[More information on Variable Types can be found in the Wiki](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki/Variable-types).**

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

I think I mentioned that there are **significant limitations** with the different variable types - its important to understand how these work in order to use this transform effectively.

[More information is being added to the docs, currently on our github Wiki](https://github.com/rmorse/babel-plugin-jsx-template-vars/wiki).

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

